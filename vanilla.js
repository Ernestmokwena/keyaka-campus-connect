    // <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    // <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    //UI missing

    // you may use the following color schemes to generate the UI
            //     --bg:         #E8EDE2;
            // --glass:      rgba(255, 255, 255, 0.78);
            // --glass-hi:   rgba(255, 255, 255, 0.92);
            // --glass-low:  rgba(255, 255, 255, 0.55);
            // --surface:    rgba(255, 255, 255, 0.82);
            // --surface-2:  rgba(245, 247, 241, 0.90);
            // --surface-3:  rgba(235, 239, 229, 0.95);
            // --border:     rgba(0, 0, 0, 0.07);
            // --border-hi:  rgba(0, 0, 0, 0.13);
            // --accent:     #C8F135;
            // --accent-dim: rgba(200, 241, 53, 0.22);
            // --accent-text:#5A7000;
            // --text-1:     #111D00;
            // --text-2:     #445230;
            // --text-3:     #8A9E74;
            // --danger:     #E53E3E;
            // --warning:    #F59E0B;
            // --safe:       #3DA01A;
            // --radius-sm:  12px;
            // --radius-md:  18px;
            // --radius-lg:  26px;
            // --radius-full: 999px;
            // --sheet-peek: 88px;
            // --sidebar-w:  340px;
            // --blur:       blur(22px);
            // --shadow-sm:  0 2px 12px rgba(0,0,0,0.07);
            // --shadow-md:  0 6px 28px rgba(0,0,0,0.11);
            // --shadow-lg:  0 16px 48px rgba(0,0,0,0.14);

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
        let routeLayer = null;
        let intersectionMarker = null;
        let dashedRouteLayer = null;
        
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

        function createUserMarkerIcon(bearing) {
            const rotation = typeof bearing === 'number' ? bearing : 0;
            return L.divIcon({
                html: `
                    <div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;position:relative;">
                        <div style="width:18px;height:18px;background:#C8F135;border:2px solid #111D00;border-radius:50%;box-shadow:0 0 0 5px rgba(200,241,53,0.35);"></div>
                        <div style="position:absolute;top:3px;left:50%;transform:translateX(-50%) rotate(${rotation}deg);transform-origin:50% 100%;">
                            <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:14px solid #111D00;"></div>
                        </div>
                    </div>
                `,
                className: '',
                iconSize: [44, 44],
                iconAnchor: [22, 22]
            });
        }

        function updateBearingMarker() {
            if (!userMarker) return;
            const bearing = getActiveBearing();
            userMarker.setIcon(createUserMarkerIcon(bearing));
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
                    .catch(() => {
                        // permission denied or unsupported
                    });
            } else {
                addListener();
            }
        }

        function clearRouteLayer() {
            if (routeLayer) {
                map.removeLayer(routeLayer);
                routeLayer = null;
            }
            if (intersectionMarker) {
                map.removeLayer(intersectionMarker);
                intersectionMarker = null;
            }
            if (dashedRouteLayer) {
                map.removeLayer(dashedRouteLayer);
                dashedRouteLayer = null;
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

        function checkOffRoute() {
            if (!routeLayer || !currentLocation || !isNavigating) return false;
            
            const routePath = routeLayer.getLatLngs();
            if (!routePath || routePath.length === 0) return false;
            
            let minDistance = Infinity;
            for (let i = 0; i < routePath.length; i++) {
                const point = routePath[i];
                const dist = haversine(
                    currentLocation.lat, currentLocation.lng,
                    point.lat, point.lng
                );
                minDistance = Math.min(minDistance, dist);
            }
            
            return minDistance > 30;
        }

        function drawDashedLineToRoute() {
            if (!routeLayer || !currentLocation || !isNavigating) return;
            
            if (dashedRouteLayer) {
                map.removeLayer(dashedRouteLayer);
                dashedRouteLayer = null;
            }
            
            const routePath = routeLayer.getLatLngs();
            if (!routePath || routePath.length === 0) return;
            
            let closestPoint = null;
            let minDistance = Infinity;
            for (let i = 0; i < routePath.length; i++) {
                const point = routePath[i];
                const dist = haversine(
                    currentLocation.lat, currentLocation.lng,
                    point.lat, point.lng
                );
                if (dist < minDistance) {
                    minDistance = dist;
                    closestPoint = point;
                }
            }
            
            if (closestPoint && minDistance > 5) {
                dashedRouteLayer = L.polyline(
                    [[currentLocation.lat, currentLocation.lng], [closestPoint.lat, closestPoint.lng]],
                    { color: "#F59E0B", weight: 3, opacity: 0.8, dashArray: "8, 8", lineCap: 'round' }
                ).addTo(map);
            }
        }

        function rerouteFromCurrentPosition() {
            if (!currentLocation || !currentDestination || !isNavigating) return;
            if (isFetchingRoute) return;
            
            offRouteBadge.style.display = 'block';
            setTimeout(() => {
                offRouteBadge.style.display = 'none';
            }, 3000);
            
            fetchRoute(true, currentLocation);
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
                        if (routeLayer) {
                            map.removeLayer(routeLayer);
                            routeLayer = null;
                        }
                        if (dashedRouteLayer) {
                            map.removeLayer(dashedRouteLayer);
                            dashedRouteLayer = null;
                        }
                        
                        const latlngs = data.path.map(p => [p[0], p[1]]);
                        
                        routeLayer = L.polyline(latlngs, {
                            color: forceReroute ? "#F59E0B" : "#C8F135",
                            weight: 5,
                            opacity: 0.95,
                            lineCap: 'round'
                        }).addTo(map);
                        
                        if (data.intersectionPoint) {
                            if (intersectionMarker) {
                                map.removeLayer(intersectionMarker);
                            }
                            intersectionMarker = L.circleMarker(
                                [data.intersectionPoint[0], data.intersectionPoint[1]],
                                { radius: 8, fillColor: "#C8F135", color: "#111D00", weight: 2, fillOpacity: 1 }
                            ).addTo(map);
                        }
                        
                        updateMetrics(data.distance);
                        
                        if (forceReroute) {
                            setTimeout(() => {
                                if (routeLayer) {
                                    routeLayer.setStyle({ color: "#C8F135" });
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

        function setDestination(dest) {
            clearRouteLayer();
            offRouteCounter = 0;
            isOffRouteFlag = false;
            
            currentDestination = dest;
            document.getElementById('destinationLabel').innerHTML = dest.name;
            document.getElementById('compactDest').innerHTML = dest.name;
            
            if (destMarker) map.removeLayer(destMarker);
            const destIcon = L.divIcon({
                html: `<div style="background:#C8F135; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 0 5px rgba(200,241,53,0.25), 0 2px 12px rgba(0,0,0,0.25); border:2px solid #111D00;"><span class="icon" style="color:#111D00; font-size:16px; font-family:'Material Symbols Outlined'; font-variation-settings:'FILL' 1;">location_on</span></div>`,
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            });
            destMarker = L.marker([dest.lat, dest.lng], { icon: destIcon }).addTo(map);
            
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
            
            if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
            
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
            map.setView([currentLocation.lat, currentLocation.lng], 18);
            sheet.classList.remove('expanded');
            sheet.classList.add('collapsed');
        }

        function stopNavigation() { 
            isNavigating = false; 
            setFollowMode(false); 
            clearDestination();
            offRouteBadge.style.display = 'none';
            if (dashedRouteLayer) {
                map.removeLayer(dashedRouteLayer);
                dashedRouteLayer = null;
            }
            stopNavBtn.classList.remove('visible');
        }
        
        function setFollowMode(enabled) {
            followMode = enabled;
            if (followMode) {
                followBtn.classList.add('follow-active');
                if (currentLocation) map.setView([currentLocation.lat, currentLocation.lng], map.getZoom());
            } else {
                followBtn.classList.remove('follow-active');
            }
            updateBearingMarker();
        }
        
        function toggleFollowMode() { setFollowMode(!followMode); }

        const campusBuildings = [
            { lat: -23.8865878, lng: 29.7410106, name: "Maths Building" },
            { lat: -23.8870926, lng: 29.7402418, name: "Digital Innovation Lab" },
            { lat: -23.8878509, lng: 29.7409511, name: "TA Hall" },
            { lat: -23.8874262, lng: 29.7397976, name: "Tiro Hall" },
            { lat: -23.8882049, lng: 29.7402466, name: "School of Law" },
            { lat: -23.8879335, lng: 29.7395395, name: "Library" },
            { lat: -23.8885565, lng: 29.7386208, name: "S Block" },
            { lat: -23.8868692, lng: 29.7376558, name: "SRC Chambers" },
            { lat: -23.8877729, lng: 29.7370029, name: "Tsalas Cafe" },
            { lat: -23.8868133, lng: 29.7363624, name: "Mashobane Res" }
        ];

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
            map = L.map('map', { zoomControl: false, attributionControl: false })
                   .setView([-23.88674, 29.73942], 18);
            L.tileLayer('https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 19 }).addTo(map);
        }

        function startGPS() {
            if (!navigator.geolocation) { statusDiv.innerHTML = "GPS not supported"; return; }
            const led = document.getElementById('gpsLed');
            let lastRerouteTime = 0;
            
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
                    
                    if (userMarker) {
                        userMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]);
                    } else {
                        userMarker = L.marker([pos.coords.latitude, pos.coords.longitude], {
                            icon: createUserMarkerIcon(getActiveBearing())
                        }).addTo(map);
                    }
                    
                    if (followMode && currentLocation) {
                        map.setView([currentLocation.lat, currentLocation.lng], map.getZoom());
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
                            if (dashedRouteLayer) {
                                map.removeLayer(dashedRouteLayer);
                                dashedRouteLayer = null;
                            }
                            return;
                        }
                        
                        const isOff = checkOffRoute();
                        const now = Date.now();
                        
                        if (isOff) {
                            offRouteCounter++;
                            drawDashedLineToRoute();
                            
                            if (offRouteCounter >= 3 && (now - lastRerouteTime) > 10000) {
                                lastRerouteTime = now;
                                rerouteFromCurrentPosition();
                                offRouteCounter = 0;
                            } else if (!isOffRouteFlag) {
                                if (routeLayer) {
                                    routeLayer.setStyle({ color: "#F59E0B" });
                                }
                                isOffRouteFlag = true;
                            }
                        } else {
                            if (offRouteCounter > 0) offRouteCounter--;
                            if (dashedRouteLayer) {
                                map.removeLayer(dashedRouteLayer);
                                dashedRouteLayer = null;
                            }
                            if (isOffRouteFlag) {
                                if (routeLayer) {
                                    routeLayer.setStyle({ color: "#C8F135" });
                                }
                                isOffRouteFlag = false;
                            }
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
        });

        window.addEventListener('beforeunload', () => {
            if (watchId) navigator.geolocation.clearWatch(watchId);
        });
