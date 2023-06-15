const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Tour = require('../models/tourModel');
const Booking = require('../models/bookingModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const factory = require('./handlerFactory');

exports.getCheckoutSession = catchAsync(
  async (request, response, next) => {
    // 1. Get the currently booked tour
    const tour = await Tour.findById(request.params.tourId);

    // 2. Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      success_url: `${request.protocol}://${request.get(
        'host'
      )}/?tour=${request.params.tourId}&user=${
        request.user.id
      }&price=${tour.price}`,
      cancel_url: `${request.protocol}://${request.get(
        'host'
      )}/tour/${tour.slug}`,
      customer_email: request.user.email,
      client_reference_id: request.params.tourId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: tour.price * 100,
            product_data: {
              name: `${tour.name} Tour`,
              description: tour.summary,
              images: [
                `https://www.natours.dev/img/tours/${tour.imageCover}`,
              ],
            },
          },
        },
      ],
    });

    // 3. Create session as response
    response.status(200).json({
      status: 'success',
      session,
    });
  }
);

exports.createBookingCheckout = catchAsync(
  async (request, response, next) => {
    // This is only TEMPORARY because it's UNSECURE: everyone can make bookings without paying
    const { tour, user, price } = request.query;

    if (!tour && !user && !price) return next();

    await Booking.create({ tour, user, price });

    response.redirect(request.originalUrl.split('?')[0]);
  }
);