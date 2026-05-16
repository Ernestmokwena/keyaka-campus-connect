let map;
let currentLocation = null;
let currentDestination = null;
let currentHeading = null;
let userMarker = null;
let destMarker = null;
let watchId = null;
let isNavigating = false;
let currentMode = "walk";
let followMode = false;
let routeSource = null;
let routeLayer = null;
let networkSource = null;
let networkLayer = null;

let isFetchingRoute = false;
let currentRouteRequestId = 0;
let offRouteCounter = 0;
let isOffRouteFlag = false;

const statusDiv = document.getElementById('gpsText');
const sheet = document.getElementById('navSheet');
const searchInput = document.getElementById('searchInput');
const suggestionsDropdown = document.getElementById('suggestionsDropdown');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const followBtn = document.getElementById('followMeBtn');
const offRouteBadge = document.getElementById('offRouteBadge');
const stopNavBtn = document.getElementById('stopNavBtn');
const rotationIndicator = document.getElementById('rotationIndicator');

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const φ1 = lat1 * toRad, φ2 = lat2 * toRad;
    const Δφ = (lat2 - lat1) * toRad;
    const Δλ = (lon2 - lon1) * toRad;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeBearing(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const φ1 = lat1 * toRad;
    const φ2 = lat2 * toRad;
    const Δλ = (lon2 - lon1) * toRad;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg * Math.atan2(y, x) + 360) % 360;
}

function getActiveBearing() {
    if (typeof currentHeading === 'number' && !isNaN(currentHeading)) {
        return currentHeading;
    }
    if (currentDestination && currentLocation) {
        return computeBearing(currentLocation.lat, currentLocation.lng, currentDestination.lat, currentDestination.lng);
    }
    return null;
}

// Create custom user marker using HTML element
function createUserMarkerElement(bearing) {
    const el = document.createElement('div');
    el.className = 'user-marker';
    const rotation = typeof bearing === 'number' ? bearing : 0;
    el.innerHTML = `
        <div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;position:relative;">
            <div style="width:18px;height:18px;background:#C8F135;border:2px solid #111D00;border-radius:50%;box-shadow:0 0 0 5px rgba(200,241,53,0.35);"></div>
            <div style="position:absolute;top:3px;left:50%;transform:translateX(-50%) rotate(${rotation}deg);transform-origin:50% 100%;">
                <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:14px solid #111D00;"></div>
            </div>
        </div>
    `;
    return el;
}

function updateBearingMarker() {
    if (!userMarker) return;
    const bearing = getActiveBearing();
    const el = createUserMarkerElement(bearing);
    userMarker.getElement().innerHTML = el.innerHTML;
    
    if (typeof bearing === 'number') {
        rotationIndicator.innerHTML = `Bearing: ${Math.round(bearing)}°`;
    }
    
    // Auto-rotate map when following
    if (followMode && typeof currentHeading === 'number' && !isNaN(currentHeading)) {
        map.easeTo({ bearing: currentHeading, duration: 300 });
        rotationIndicator.innerHTML = `Bearing: ${Math.round(currentHeading)}° | Following`;
    }
}

function handleDeviceOrientation(event) {
    let heading = null;
    if (typeof event.webkitCompassHeading === 'number') {
        heading = event.webkitCompassHeading;
    } else if (typeof event.alpha === 'number') {
        const screenAngle = window.screen.orientation?.angle || window.orientation || 0;
        heading = 360 - event.alpha;
        heading = (heading + screenAngle) % 360;
    }
    if (typeof heading === 'number' && !isNaN(heading)) {
        currentHeading = heading;
        updateBearingMarker();
    }
}

function initHeadingSensors() {
    if (typeof DeviceOrientationEvent === 'undefined') return;
    const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    const addListener = () => window.addEventListener(eventName, handleDeviceOrientation, true);
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permission => {
                if (permission === 'granted') addListener();
            })
            .catch(() => {});
    } else {
        addListener();
    }
}

function clearRouteLayer() {
    if (map.getLayer('route')) {
        map.removeLayer('route');
    }
    if (map.getSource('route')) {
        map.removeSource('route');
    }
    if (map.getLayer('dashed-route')) {
        map.removeLayer('dashed-route');
    }
    if (map.getSource('dashed-route')) {
        map.removeSource('dashed-route');
    }
}

function updateMetrics(distance) {
    if (!distance && distance !== 0) return;
    const time = currentMode === "walk" ? distance / (1.4 * 60) : distance / (8 * 60);
    const distText = distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(1)}km`;
    document.getElementById('distanceVal').innerHTML = distText;
    document.getElementById('timeVal').innerHTML = `${Math.ceil(time)} min`;
    document.getElementById('compactDistance').innerHTML = distText;
}

function fetchRoute(forceReroute = false, startPoint = null) {
    if (!currentDestination) return;
    
    const routeStart = startPoint || currentLocation;
    if (!routeStart) return;
    
    if (isFetchingRoute) return;
    
    isFetchingRoute = true;
    const thisRequestId = ++currentRouteRequestId;
    
    const url = `/api/route?startLat=${routeStart.lat}&startLng=${routeStart.lng}&endLat=${currentDestination.lat}&endLng=${currentDestination.lng}&mode=${currentMode}`;
    
    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (thisRequestId !== currentRouteRequestId) {
                isFetchingRoute = false;
                return;
            }
            
            if (data.path && data.path.length > 0) {
                clearRouteLayer();
                
                const coordinates = data.path.map(p => [p[1], p[0]]);
                
                // Add route source and layer
                map.addSource('route', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: {
                            type: 'LineString',
                            coordinates: coordinates
                        }
                    }
                });
                
                map.addLayer({
                    id: 'route',
                    type: 'line',
                    source: 'route',
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': forceReroute ? '#F59E0B' : '#C8F135',
                        'line-width': 5,
                        'line-opacity': 0.95
                    }
                });
                
                updateMetrics(data.distance);
                
                if (forceReroute) {
                    setTimeout(() => {
                        if (map.getLayer('route')) {
                            map.setPaintProperty('route', 'line-color', '#C8F135');
                        }
                        offRouteCounter = 0;
                        isOffRouteFlag = false;
                    }, 5000);
                }
            }
            isFetchingRoute = false;
        })
        .catch(err => {
            console.error("Route error:", err);
            isFetchingRoute = false;
        });
}

// Load GeoJSON network overlay
async function loadNetworkOverlay() {
    try {
        const response = await fetch('/api/network-data');
        const geojson = await response.json();
        
        if (geojson && geojson.features && geojson.features.length > 0) {
            map.addSource('network', {
                type: 'geojson',
                data: geojson
            });
            
            map.addLayer({
                id: 'network',
                type: 'line',
                source: 'network',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#F2C94C',
                    'line-width': 3,
                    'line-opacity': 0.7
                }
            });
            
            console.log(`Network overlay loaded: ${geojson.features.length} features`);
            statusDiv.innerHTML = `GPS active · ${geojson.features.length} paths loaded`;
        } else {
            statusDiv.innerHTML = "GPS active · No network data";
        }
    } catch (err) {
        console.error('Failed to load network overlay:', err);
        statusDiv.innerHTML = "GPS active · Network overlay failed";
    }
}

function setDestination(dest) {
    clearRouteLayer();
    offRouteCounter = 0;
    isOffRouteFlag = false;
    
    currentDestination = dest;
    document.getElementById('destinationLabel').innerHTML = dest.name;
    document.getElementById('compactDest').innerHTML = dest.name;
    
    if (destMarker) destMarker.remove();
    
    // Create destination marker
    const el = document.createElement('div');
    el.innerHTML = `<div style="background:#C8F135; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 0 5px rgba(200,241,53,0.25), 0 2px 12px rgba(0,0,0,0.25); border:2px solid #111D00;"><span class="icon" style="color:#111D00; font-size:16px; font-family:'Material Symbols Outlined'; font-variation-settings:'FILL' 1;">location_on</span></div>`;
    
    destMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([dest.lng, dest.lat])
        .addTo(map);
    
    if (currentLocation) fetchRoute(false, currentLocation);
    updateBearingMarker();
    sheet.classList.remove('inactive');
    sheet.classList.add('expanded');
}

function clearDestination() {
    clearRouteLayer();
    offRouteCounter = 0;
    isOffRouteFlag = false;
    
    currentDestination = null;
    
    if (destMarker) { destMarker.remove(); destMarker = null; }
    
    document.getElementById('destinationLabel').innerHTML = "Select destination";
    document.getElementById('compactDest').innerHTML = "Select destination";
    document.getElementById('distanceVal').innerHTML = "—";
    document.getElementById('timeVal').innerHTML = "—";
    document.getElementById('compactDistance').innerHTML = "—";
    sheet.classList.add('inactive');
}

function startNavigation() {
    if (!currentLocation) return;
    if (!currentDestination) { 
        sheet.classList.add('expanded'); 
        searchInput.focus(); 
        return; 
    }
    isNavigating = true;
    offRouteCounter = 0;
    isOffRouteFlag = false;
    
    stopNavBtn.classList.add('visible');
    
    fetchRoute(false, currentLocation);
    map.flyTo({
        center: [currentLocation.lng, currentLocation.lat],
        zoom: 18,
        duration: 1000
    });
    sheet.classList.remove('expanded');
    sheet.classList.add('collapsed');
}

function stopNavigation() { 
    isNavigating = false; 
    setFollowMode(false); 
    clearDestination();
    offRouteBadge.style.display = 'none';
    stopNavBtn.classList.remove('visible');
}

function setFollowMode(enabled) {
    followMode = enabled;
    if (followMode) {
        followBtn.classList.add('follow-active');
        if (currentLocation) {
            map.flyTo({
                center: [currentLocation.lng, currentLocation.lat],
                zoom: map.getZoom(),
                duration: 500
            });
        }
        rotationIndicator.style.background = 'var(--accent-dim)';
    } else {
        followBtn.classList.remove('follow-active');
        map.easeTo({ bearing: 0, duration: 500 });
        rotationIndicator.style.background = 'var(--surface)';
    }
    updateBearingMarker();
}

function toggleFollowMode() { setFollowMode(!followMode); }

function resetNorth() {
    map.easeTo({ bearing: 0, duration: 500 });
    if (followMode) setFollowMode(false);
    rotationIndicator.innerHTML = `Bearing: 0°`;
}

function testRotation() {
    let rotationAngle = 0;
    const interval = setInterval(() => {
        rotationAngle = (rotationAngle + 45) % 360;
        map.easeTo({ bearing: rotationAngle, duration: 600 });
        rotationIndicator.innerHTML = `Test Rotation: ${rotationAngle}°`;
        if (rotationAngle === 0) {
            clearInterval(interval);
            rotationIndicator.innerHTML = `Bearing: 0° | Test Complete`;
        }
    }, 800);
}



function getSuggestions(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return campusBuildings.filter(b => b.name.toLowerCase().includes(q)).map(b => ({
        ...b,
        distance: currentLocation ? haversine(currentLocation.lat, currentLocation.lng, b.lat, b.lng) : null
    }));
}

function showSuggestions(suggestions) {
    if (suggestions.length === 0) { suggestionsDropdown.classList.remove('show'); return; }
    suggestionsDropdown.innerHTML = suggestions.map(b => `
        <div class="suggestion-item" data-lat="${b.lat}" data-lng="${b.lng}" data-name="${b.name.replace(/'/g, "\\'")}">
            <div class="sug-dot"></div>
            <div class="suggestion-name">${b.name}</div>
            ${b.distance ? `<span class="suggestion-dist">${b.distance < 1000 ? Math.round(b.distance) + 'm' : (b.distance/1000).toFixed(1) + 'km'}</span>` : ''}
        </div>`).join('');
    suggestionsDropdown.classList.add('show');
    document.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            setDestination({ lat: parseFloat(item.dataset.lat), lng: parseFloat(item.dataset.lng), name: item.dataset.name });
            searchInput.value = item.dataset.name;
            suggestionsDropdown.classList.remove('show');
        });
    });
}

function checkNetworkStatus() {
    fetch('/api/stats')
        .then(response => response.json())
        .then(data => {
            if (data.loaded) {
                statusDiv.innerHTML = `GPS active · ${data.nodeCount} nodes ready`;
                if (currentLocation && currentDestination && !isNavigating) fetchRoute(false, currentLocation);
            } else {
                statusDiv.innerHTML = "Waiting for network…";
                setTimeout(checkNetworkStatus, 2000);
            }
        })
        .catch(() => {
            statusDiv.innerHTML = "Connecting to server…";
            setTimeout(checkNetworkStatus, 3000);
        });
}

function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'raster-tiles': {
                    type: 'raster',
                    tiles: ['https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'],
                    tileSize: 256,
                    attribution: 'Google Satellite'
                }
            },
            layers: [{
                id: 'satellite',
                type: 'raster',
                source: 'raster-tiles',
                minzoom: 0,
                maxzoom: 22
            }]
        },
        center: [29.73942, -23.88674],
        zoom: 18,
        bearing: 0,
        pitch: 0,
        touchZoomRotate: true,
        dragRotate: true
    });
    
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: false }), 'top-right');
    
    map.on('load', () => {
        loadNetworkOverlay();
    });
    
    map.on('rotate', () => {
        const bearing = map.getBearing();
        rotationIndicator.innerHTML = `Bearing: ${Math.round(bearing)}°`;
        if (!followMode) {
            rotationIndicator.style.background = 'var(--surface)';
        }
    });
    
    // Add user marker
    const userEl = createUserMarkerElement(0);
    userMarker = new maplibregl.Marker({ element: userEl, anchor: 'center' })
        .setLngLat([29.73942, -23.88674])
        .addTo(map);
}

function startGPS() {
    if (!navigator.geolocation) { statusDiv.innerHTML = "GPS not supported"; return; }
    const led = document.getElementById('gpsLed');
    
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            currentLocation = newLoc;
            if (typeof pos.coords.heading === 'number' && !isNaN(pos.coords.heading)) {
                currentHeading = pos.coords.heading;
            } else {
                currentHeading = null;
            }
            document.getElementById('departureLabel').innerHTML = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
            led.classList.add('live');
            
            userMarker.setLngLat([pos.coords.longitude, pos.coords.latitude]);
            
            if (followMode && currentLocation) {
                map.flyTo({
                    center: [currentLocation.lng, currentLocation.lat],
                    duration: 500
                });
            }
            updateBearingMarker();
            
            if (currentDestination && isNavigating) {
                const remainingDist = haversine(
                    currentLocation.lat, currentLocation.lng,
                    currentDestination.lat, currentDestination.lng
                );
                updateMetrics(remainingDist);
                
                if (remainingDist < 20) {
                    isNavigating = false;
                    setFollowMode(false);
                    stopNavBtn.classList.remove('visible');
                    statusDiv.innerHTML = "Arrived!";
                    if (window.navigator.vibrate) window.navigator.vibrate(200);
                    sheet.classList.add('expanded');
                    offRouteBadge.style.display = 'none';
                }
            } else if (currentDestination && !isNavigating) {
                const dist = haversine(
                    currentLocation.lat, currentLocation.lng,
                    currentDestination.lat, currentDestination.lng
                );
                updateMetrics(dist);
            }
        },
        (error) => {
            led.classList.remove('live');
            statusDiv.innerHTML = error.code === 1 ? "Location permission denied" : "GPS error";
        },
        { enableHighAccuracy: true, maximumAge: 6000, timeout: 10000 }
    );
}

// Event Listeners
document.getElementById('modeToggle').addEventListener('click', () => {
    currentMode = currentMode === "walk" ? "drive" : "walk";
    const isWalk = currentMode === "walk";
    document.getElementById('modeIcon').innerHTML = isWalk ? 'directions_walk' : 'directions_car';
    document.getElementById('modeText').innerHTML = isWalk ? 'Walk' : 'Drive';
    document.getElementById('sheetModeIcon').innerHTML = isWalk ? 'directions_walk' : 'directions_car';
    document.getElementById('compactMode').innerHTML = `<span class="icon icon-sm">${isWalk ? 'directions_walk' : 'directions_car'}</span>`;
    if (currentLocation && currentDestination) fetchRoute(false, currentLocation);
});

document.getElementById('zoomInBtn').addEventListener('click', () => map.zoomIn());
document.getElementById('zoomOutBtn').addEventListener('click', () => map.zoomOut());
document.getElementById('rotateTestBtn').addEventListener('click', testRotation);
document.getElementById('resetNorthBtn').addEventListener('click', resetNorth);
followBtn.addEventListener('click', toggleFollowMode);
document.getElementById('startNavBtn').addEventListener('click', startNavigation);
document.getElementById('stopNavBtn').addEventListener('click', stopNavigation);
document.getElementById('navTabBtn').addEventListener('click', () => {
    if (!sheet.classList.contains('inactive')) {
        sheet.classList.remove('collapsed');
        sheet.classList.add('expanded');
    }
});
document.getElementById('handleArea').addEventListener('click', () => {
    if (sheet.classList.contains('inactive')) return;
    if (sheet.classList.contains('expanded')) {
        sheet.classList.remove('expanded');
        sheet.classList.add('collapsed');
    } else {
        sheet.classList.remove('collapsed');
        sheet.classList.add('expanded');
    }
});
document.getElementById('compactInfo').addEventListener('click', () => {
    if (!sheet.classList.contains('inactive')) {
        sheet.classList.remove('collapsed');
        sheet.classList.add('expanded');
    }
});
document.getElementById('closeSheetBtn').addEventListener('click', () => {
    sheet.classList.remove('expanded');
    sheet.classList.add('collapsed');
});

let searchTimeout;
searchInput.addEventListener('input', (e) => {
    clearSearchBtn.style.display = e.target.value ? 'flex' : 'none';
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        showSuggestions(getSuggestions(e.target.value.toLowerCase()));
    }, 150);
});

clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    suggestionsDropdown.classList.remove('show');
    searchInput.focus();
});

document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestionsDropdown.contains(e.target)) {
        suggestionsDropdown.classList.remove('show');
    }
});

window.addEventListener('load', () => {
    initMap();
    startGPS();
    initHeadingSensors();
    checkNetworkStatus();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
});

window.addEventListener('beforeunload', () => {
    if (watchId) navigator.geolocation.clearWatch(watchId);
});
