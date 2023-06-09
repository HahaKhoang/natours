const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Email = require('../utils/email');

const signToken = (id) =>
  jwt.sign({ id: id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const createSendToken = (user, statusCode, response) => {
  const token = signToken(user._id);
  const cookieOptions = {
    expires: new Date(
      Date.now() +
        process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
  };
  if (process.env.NODE_ENV === 'production')
    cookieOptions.secure = true;

  response.cookie('jwt', token, cookieOptions);

  // Remove password from the output
  user.password = undefined;

  response.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

exports.signup = catchAsync(async (request, response, next) => {
  const newUser = await User.create({
    name: request.body.name,
    email: request.body.email,
    password: request.body.password,
    passwordConfirm: request.body.passwordConfirm,
    passwordChangedAt: request.body.passwordChangedAt,
    role: request.body.role,
  });
  const url = `${request.protocol}://${request.get('host')}/me`;
  await new Email(newUser, url).sendWelcome();
  createSendToken(newUser, 201, response);
});

exports.login = catchAsync(async (request, response, next) => {
  const { email, password } = request.body;

  // 1. Check if email and password exist
  if (!email || !password) {
    return next(
      new AppError('Please provide email and password!', 400)
    );
  }
  // 2. Check if user exists && password is correct
  const user = await User.findOne({ email: email }).select(
    '+password'
  );

  if (
    !user ||
    !(await user.correctPassword(password, user.password))
  ) {
    return next(new AppError('Incorrect email or password', 401));
  }
  // 3. If everything is okay, send token to client
  createSendToken(user, 200, response);
});

exports.logout = (request, response) => {
  response.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  response.status(200).json({
    status: 'success',
  });
};

exports.protect = catchAsync(async (request, response, next) => {
  let token;
  // 1. Getting token and check if it's there
  if (
    request.headers.authorization &&
    request.headers.authorization.startsWith('Bearer')
  ) {
    token = request.headers.authorization.split(' ')[1];
  } else if (request.cookies.jwt) {
    token = request.cookies.jwt;
  }

  if (!token) {
    return next(
      new AppError(
        'You are not logged in! Please log in to get access',
        401
      )
    );
  }
  // 2. Verification of token
  const decoded = await promisify(jwt.verify)(
    token,
    process.env.JWT_SECRET
  );

  // 3. Check if user still exists
  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(
      new AppError(
        'The user belonging to this token no longer exists.',
        401
      )
    );
  }

  // 4. Check if user changed password after the token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError(
        'User recently changed password! Please log in again.',
        401
      )
    );
  }

  // 5. Grants access to protected route
  request.user = currentUser;
  response.locals.user = currentUser;
  next();
});

// Only for rendered pages, no errors!
exports.isLoggedIn = async (request, response, next) => {
  if (request.cookies.jwt) {
    try {
      // 1. Verify token
      const decoded = await promisify(jwt.verify)(
        request.cookies.jwt,
        process.env.JWT_SECRET
      );

      // 2. Check if user still exists
      const currentUser = await User.findById(decoded.id);
      if (!currentUser) {
        return next();
      }

      // 3. Check if user changed password after the token was issued
      if (currentUser.changedPasswordAfter(decoded.iat)) {
        return next(new AppError());
      }

      // 4. THERE IS A LOGGED IN USER
      response.locals.user = currentUser;
      return next();
    } catch (error) {
      return next();
    }
  }
  next();
};

// eslint-disable-next-line arrow-body-style
exports.restrictTo = (...roles) => {
  return (request, response, next) => {
    // roles is an array ['admin', 'lead-guide]
    if (!roles.includes(request.user.role)) {
      return next(
        new AppError(
          'You do not have permission to perform this action',
          403
        )
      );
    }
    next();
  };
};

exports.forgotPassword = catchAsync(
  async (request, response, next) => {
    // 1. Get user based on POSTed email
    const user = await User.findOne({ email: request.body.email });
    if (!user) {
      return next(
        new AppError('There is no user with that email address.', 404)
      );
    }

    // 2. Generate the random reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // 3. Send it to user's email
    try {
      const resetURL = `${request.protocol}://${request.get(
        'host'
      )}/api/v1/users/resetPassword/${resetToken}`;

      await new Email(user, resetURL).sendPasswordReset();

      response.status(200).json({
        status: 'success',
        message: 'Token sent to email!',
      });
    } catch (error) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });

      return next(
        new AppError(
          'There was an error sending the email. Try again later!'
        ),
        500
      );
    }
  }
);

exports.resetPassword = catchAsync(
  async (request, response, next) => {
    // 1. Get user based on the token
    const hashedToken = crypto
      .createHash('sha256')
      .update(request.params.token)
      .digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    // 2. If token has not expired, and there is user, set the new password
    if (!user) {
      return next(
        new AppError('Token is invalid or has expired'),
        400
      );
    }
    user.password = request.body.password;
    user.passwordConfirm = request.body.passwordConfirm;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    // 3. Update changedPasswordAt property for the user
    // 4. Log the user in, send JWT to client
    createSendToken(user, 200, response);
  }
);

exports.updatePassword = catchAsync(
  async (request, response, next) => {
    // 1. Get user from collection
    const user = await User.findById(request.user.id).select(
      '+password'
    );

    // 2. Check if POSTed current password is correct
    if (
      !(await user.correctPassword(
        request.body.passwordCurrent,
        user.password
      ))
    ) {
      return next(
        new AppError('Your current password is wrong', 401)
      );
    }

    // 3. If so, update password
    user.password = request.body.password;
    user.passwordConfirm = request.body.passwordConfirm;
    await user.save();
    // User.findByIdAndUpdate will NOT work as intended!

    // 4. Log user in, send JWT
    createSendToken(user, 200, response);
  }
);
