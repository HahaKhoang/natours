/* eslint-disable */

export const displayMap = (locations) => {
  mapboxgl.accessToken =
    'pk.eyJ1IjoiaGFoYWhvYW5nIiwiYSI6ImNsaW5iZHluejBqd2YzcnRod2RydGJ1bnAifQ.2ZScbLOTbhLxDGZ2i_g1sw';
  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/hahahoang/clinbivpo01bn01p65gb1fw14',
    scrollZoom: false,
  });

  const bounds = new mapboxgl.LngLatBounds();

  locations.forEach((location) => {
    // Create marker
    const marker = document.createElement('div');
    marker.className = 'marker';

    // Add marker
    new mapboxgl.Marker({
      element: marker,
      anchor: 'bottom',
    })
      .setLngLat(location.coordinates)
      .addTo(map);

    // Add popup
    new mapboxgl.Popup({ offset: 30 })
      .setLngLat(location.coordinates)
      .setHTML(`<p>Day ${location.day}: ${location.description}</p>`)
      .addTo(map);

    // Extend map bounds to include current location
    bounds.extend(location.coordinates);
  });

  map.fitBounds(bounds, {
    padding: {
      top: 200,
      bottom: 150,
      left: 100,
      right: 100,
    },
  });
};
