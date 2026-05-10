const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

function haversineDistance(point1, point2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const φ1 = point1.lat * toRad;
    const φ2 = point2.lat * toRad;
    const Δφ = (point2.lat - point1.lat) * toRad;
    const Δλ = (point2.lng - point1.lng) * toRad;
    
    const a = Math.sin(Δφ / 2) ** 2 +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
}

function findClosestNode(nodes, point) {
    let closestKey = null;
    let minDist = Infinity;
    
    for (let [key, node] of nodes) {
        const dist = haversineDistance(point, { lat: node.lat, lng: node.lng });
        if (dist < minDist) {
            minDist = dist;
            closestKey = key;
        }
    }
    
    return { key: closestKey, distance: minDist };
}

function buildGraphFromGeoJson(geojson) {
    const graph = new Map();
    const nodes = new Map();
    const nodeKeysList = [];
    
    function pointKey(lat, lng, precision = 8) {
        return `${lat.toFixed(precision)},${lng.toFixed(precision)}`;
    }
    
    function addNode(lat, lng) {
        const key = pointKey(lat, lng);
        if (!nodes.has(key)) {
            nodes.set(key, { lat, lng, key });
            nodeKeysList.push(key);
            graph.set(key, []);
        }
        return key;
    }
    
    function addBidirectionalEdge(key1, key2) {
        if (key1 === key2) return;
        const node1 = nodes.get(key1);
        const node2 = nodes.get(key2);
        if (!node1 || !node2) return;
        
        const dist = haversineDistance(
            { lat: node1.lat, lng: node1.lng },
            { lat: node2.lat, lng: node2.lng }
        );
        
        const edges1 = graph.get(key1);
        const edges2 = graph.get(key2);
        
        if (!edges1.some(e => e.node === key2)) {
            edges1.push({ node: key2, distance: dist });
        }
        if (!edges2.some(e => e.node === key1)) {
            edges2.push({ node: key1, distance: dist });
        }
    }
    
    if (geojson && geojson.features) {
        geojson.features.forEach(feature => {
            const geom = feature.geometry;
            if (geom && geom.type === 'LineString') {
                const coords = geom.coordinates;
                let previousKey = null;
                for (let i = 0; i < coords.length; i++) {
                    const c = coords[i];
                    const nodeKey = addNode(c[1], c[0]);
                    if (previousKey !== null) {
                        addBidirectionalEdge(previousKey, nodeKey);
                    }
                    previousKey = nodeKey;
                }
            }
        });
    }
    
    return { graph, nodes, nodeKeysList };
}

function dijkstra(graph, nodes, nodeKeysList, startKey, goalKey) {
    const dist = new Map();
    const prev = new Map();
    const unvisited = new Set();
    
    for (let key of nodeKeysList) {
        dist.set(key, Infinity);
        unvisited.add(key);
    }
    dist.set(startKey, 0);
    
    while (unvisited.size > 0) {
        let current = null;
        let minDist = Infinity;
        for (let key of unvisited) {
            const d = dist.get(key);
            if (d < minDist) {
                minDist = d;
                current = key;
            }
        }
        
        if (current === null || current === goalKey) break;
        unvisited.delete(current);
        
        const neighbors = graph.get(current) || [];
        for (let neighbor of neighbors) {
            const alt = dist.get(current) + neighbor.distance;
            if (alt < dist.get(neighbor.node)) {
                dist.set(neighbor.node, alt);
                prev.set(neighbor.node, current);
            }
        }
    }
    
    if (dist.get(goalKey) === Infinity) return null;
    
    const pathKeys = [];
    let current = goalKey;
    while (current && current !== startKey) {
        pathKeys.unshift(current);
        current = prev.get(current);
    }
    pathKeys.unshift(startKey);
    
    return { keys: pathKeys, distance: dist.get(goalKey) };
}

// Find the first intersection between direct ray and network
function findFirstRayNetworkIntersection(graph, nodes, start, end) {
    let firstIntersection = null;
    let minDistanceFromStart = Infinity;
    const checkedEdges = new Set();
    
    for (let [key1, edges] of graph) {
        const node1 = nodes.get(key1);
        if (!node1) continue;
        for (let edge of edges) {
            const edgeId = `${key1}|${edge.node}`;
            if (checkedEdges.has(edgeId)) continue;
            checkedEdges.add(edgeId);
            const node2 = nodes.get(edge.node);
            if (!node2) continue;
            
            // Check if ray from start to end intersects this edge
            const rayStart = { x: start.lng, y: start.lat };
            const rayEnd = { x: end.lng, y: end.lat };
            const edgeStart = { x: node1.lng, y: node1.lat };
            const edgeEnd = { x: node2.lng, y: node2.lat };
            
            const intersection = lineIntersection(rayStart, rayEnd, edgeStart, edgeEnd);
            if (intersection) {
                const intersectPoint = { lat: intersection.y, lng: intersection.x };
                const distFromStart = haversineDistance(start, intersectPoint);
                if (distFromStart < minDistanceFromStart && distFromStart > 1) {
                    minDistanceFromStart = distFromStart;
                    firstIntersection = intersectPoint;
                }
            }
        }
    }
    return { intersection: firstIntersection, distance: minDistanceFromStart };
}

function lineIntersection(p1, p2, p3, p4) {
    const denominator = ((p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y));
    if (denominator === 0) return null;
    
    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator;
    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator;
    
    if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
    
    return {
        x: p1.x + ua * (p2.x - p1.x),
        y: p1.y + ua * (p2.y - p1.y)
    };
}

// Cache for graph data
let cachedGraph = null;
let cachedNodes = null;
let cachedNodeKeysList = null;

function loadAndCacheGraph() {
    const geojsonPath = '/etc/secrets/main.geojson';
    
    try {
        if (fs.existsSync(geojsonPath)) {
            const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
            const { graph, nodes, nodeKeysList } = buildGraphFromGeoJson(geojson);
            cachedGraph = graph;
            cachedNodes = nodes;
            cachedNodeKeysList = nodeKeysList;
            console.log(`✅ Loaded GeoJSON: ${nodes.size} nodes, ${graph.size} edges`);
            return true;
        } else {
            console.log(`❌ GeoJSON file not found at: ${geojsonPath}`);
            return false;
        }
    } catch (err) {
        console.error(`❌ Error loading GeoJSON:`, err.message);
        return false;
    }
}

// Ray-First Route endpoint
app.get('/api/route', (req, res) => {
    const { startLat, startLng, endLat, endLng, mode = 'walk' } = req.query;
    
    if (!startLat || !startLng || !endLat || !endLng) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }
    
    const start = { lat: parseFloat(startLat), lng: parseFloat(startLng) };
    const end = { lat: parseFloat(endLat), lng: parseFloat(endLng) };
    
    // If graph isn't loaded, return direct route
    if (!cachedGraph || cachedNodes.size === 0) {
        const directDistance = haversineDistance(start, end);
        const speed = mode === 'walk' ? 1.4 : 8;
        const timeMinutes = Math.ceil(directDistance / (speed * 60));
        
        return res.json({
            status: 'success',
            distance: directDistance,
            duration: timeMinutes,
            path: [[start.lat, start.lng], [end.lat, end.lng]],
            mode: mode,
            usedNetwork: false
        });
    }
    
    // RAY-FIRST: Find intersection with network
    const { intersection, distance: rayToIntersectDist } = findFirstRayNetworkIntersection(
        cachedGraph, cachedNodes, start, end
    );
    
    // If no intersection, return direct route
    if (!intersection) {
        const directDistance = haversineDistance(start, end);
        const speed = mode === 'walk' ? 1.4 : 8;
        const timeMinutes = Math.ceil(directDistance / (speed * 60));
        
        return res.json({
            status: 'success',
            distance: directDistance,
            duration: timeMinutes,
            path: [[start.lat, start.lng], [end.lat, end.lng]],
            mode: mode,
            usedNetwork: false
        });
    }
    
    // Find closest nodes to intersection and destination
    const intersectionNodeKey = findClosestNode(cachedNodes, intersection).key;
    const endNodeKey = findClosestNode(cachedNodes, end).key;
    
    if (!intersectionNodeKey || !endNodeKey) {
        const directDistance = haversineDistance(start, end);
        const speed = mode === 'walk' ? 1.4 : 8;
        const timeMinutes = Math.ceil(directDistance / (speed * 60));
        
        return res.json({
            status: 'success',
            distance: directDistance,
            duration: timeMinutes,
            path: [[start.lat, start.lng], [end.lat, end.lng]],
            mode: mode,
            usedNetwork: false
        });
    }
    
    // Get network path from intersection to destination
    const networkPath = dijkstra(cachedGraph, cachedNodes, cachedNodeKeysList, intersectionNodeKey, endNodeKey);
    
    if (!networkPath) {
        const directDistance = haversineDistance(start, end);
        const speed = mode === 'walk' ? 1.4 : 8;
        const timeMinutes = Math.ceil(directDistance / (speed * 60));
        
        return res.json({
            status: 'success',
            distance: directDistance,
            duration: timeMinutes,
            path: [[start.lat, start.lng], [end.lat, end.lng]],
            mode: mode,
            usedNetwork: false
        });
    }
    
    // Build full path: start -> intersection -> network path -> end
    const path = [
        [start.lat, start.lng],
        [intersection.lat, intersection.lng],
        ...networkPath.keys.map(key => [cachedNodes.get(key).lat, cachedNodes.get(key).lng]),
        [end.lat, end.lng]
    ];
    
    const totalDistance = rayToIntersectDist + networkPath.distance;
    const speed = mode === 'walk' ? 1.4 : 8;
    const timeMinutes = Math.ceil(totalDistance / (speed * 60));
    
    res.json({
        status: 'success',
        distance: totalDistance,
        duration: timeMinutes,
        path: path,
        mode: mode,
        usedNetwork: true,
        intersectionPoint: [intersection.lat, intersection.lng]
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        loaded: cachedGraph !== null,
        nodeCount: cachedNodes ? cachedNodes.size : 0,
        edgeCount: cachedGraph ? cachedGraph.size : 0
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║     Campus Navigator Server Ready      ║
╠════════════════════════════════════════╣
║  Port: ${PORT}                              ║
║  URL:  http://localhost:${PORT}          ║
╠════════════════════════════════════════╣
    `);
    
    loadAndCacheGraph();
});
