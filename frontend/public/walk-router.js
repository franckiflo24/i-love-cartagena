// AMO Walk Router — client-side walking routes over the committed OSM graph
// (public/data/walkgraph.json, built by scripts/build-walk-graph.mjs).
//
// Single source of truth for BOTH render paths: the web map loads it via a
// <script> tag next to Leaflet; the native WebView document loads it from the
// production origin. Plain JS on purpose — no bundler, no imports.
//
// API (window.AmoWalkRouter):
//   load(url)                 idempotent; resolves when the graph is ready
//   ready()                   -> bool
//   route(points)             points = [[lat,lng],...] visited in order.
//     -> { line: [[lat,lng],...], meters, minutes, legs: [{meters,minutes}] }
//        or null when the graph isn't loaded / no path exists.
//   orderStops(origin, stops) -> stops reordered for a short walk
//     (nearest-neighbor + 2-opt; origin = [lat,lng], stops = [{lat,lng,...}])
//   measure(line)             -> cumulative meters per vertex (graph not needed)
//   pointAt(line, cum, f)     -> [lat,lng] at fraction f of the line's length —
//     constant-speed interpolation for animating a marker along a route
(function () {
  var G = null; // { nodes: Float64Array-ish flat [lat,lng...], adj: Map(idx -> [idx, dm, ...]) }
  var loading = null;
  var WALK_M_PER_MIN = 76.7; // 4.6 km/h

  function hav(a, b, c, d) {
    var R = 6371000, dl = (c - a) * Math.PI / 180, dg = (d - b) * Math.PI / 180;
    var x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dg / 2) * Math.sin(dg / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function build(raw) {
    var n = raw.nodes.length / 2;
    var adj = new Array(n);
    for (var e = 0; e < raw.edges.length; e += 3) {
      var a = raw.edges[e], b = raw.edges[e + 1], dm = raw.edges[e + 2];
      (adj[a] = adj[a] || []).push(b, dm);
      (adj[b] = adj[b] || []).push(a, dm);
    }
    G = { nodes: raw.nodes, n: n, adj: adj };
  }

  function nearestNode(lat, lng) {
    var bi = -1, bd = Infinity;
    for (var i = 0; i < G.n; i++) {
      var d = hav(lat, lng, G.nodes[i * 2], G.nodes[i * 2 + 1]);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  // Binary min-heap keyed on f-score.
  function Heap() { this.a = []; }
  Heap.prototype.push = function (f, v) {
    var a = this.a; a.push([f, v]);
    var i = a.length - 1;
    while (i > 0) { var p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
  };
  Heap.prototype.pop = function () {
    var a = this.a; if (!a.length) return null;
    var top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, s = i;
        if (l < a.length && a[l][0] < a[s][0]) s = l;
        if (r < a.length && a[r][0] < a[s][0]) s = r;
        if (s === i) break;
        var t = a[s]; a[s] = a[i]; a[i] = t; i = s;
      }
    }
    return top;
  };

  function astar(s, t) {
    var dist = new Float64Array(G.n).fill(Infinity);
    var prev = new Int32Array(G.n).fill(-1);
    var done = new Uint8Array(G.n);
    var tl = G.nodes[t * 2], tg = G.nodes[t * 2 + 1];
    dist[s] = 0;
    var h = new Heap();
    h.push(hav(G.nodes[s * 2], G.nodes[s * 2 + 1], tl, tg), s);
    for (;;) {
      var top = h.pop();
      if (!top) return null;
      var u = top[1];
      if (done[u]) continue;
      done[u] = 1;
      if (u === t) break;
      var nb = G.adj[u];
      if (!nb) continue;
      for (var k = 0; k < nb.length; k += 2) {
        var v = nb[k], nd = dist[u] + nb[k + 1] / 10;
        if (nd < dist[v]) {
          dist[v] = nd; prev[v] = u;
          h.push(nd + hav(G.nodes[v * 2], G.nodes[v * 2 + 1], tl, tg), v);
        }
      }
    }
    var path = [], c = t;
    while (c !== -1) { path.push(c); c = prev[c]; }
    path.reverse();
    return { path: path, meters: dist[t] };
  }

  window.AmoWalkRouter = {
    load: function (url) {
      if (G) return Promise.resolve();
      if (loading) return loading;
      loading = fetch(url).then(function (r) {
        if (!r.ok) throw new Error('walkgraph ' + r.status);
        return r.json();
      }).then(function (raw) { build(raw); }).catch(function (e) {
        loading = null; // allow retry
        throw e;
      });
      return loading;
    },
    ready: function () { return !!G; },
    route: function (points) {
      if (!G || !points || points.length < 2) return null;
      var line = [], legs = [], total = 0;
      for (var i = 0; i + 1 < points.length; i++) {
        var A = points[i], B = points[i + 1];
        var s = nearestNode(A[0], A[1]), t = nearestNode(B[0], B[1]);
        var r = (s === t) ? { path: [s], meters: 0 } : astar(s, t);
        if (!r) return null;
        var legM = r.meters
          + hav(A[0], A[1], G.nodes[s * 2], G.nodes[s * 2 + 1])
          + hav(B[0], B[1], G.nodes[t * 2], G.nodes[t * 2 + 1]);
        // connector from the true point onto the network and off it again —
        // the drawn line must touch the venue, not stop at the nearest corner.
        if (i === 0) line.push([A[0], A[1]]);
        for (var p = 0; p < r.path.length; p++) {
          var ni = r.path[p];
          line.push([G.nodes[ni * 2], G.nodes[ni * 2 + 1]]);
        }
        line.push([B[0], B[1]]);
        legs.push({ meters: Math.round(legM), minutes: Math.max(1, Math.round(legM / WALK_M_PER_MIN)) });
        total += legM;
      }
      return {
        line: line,
        meters: Math.round(total),
        minutes: Math.max(1, Math.round(total / WALK_M_PER_MIN)),
        legs: legs,
      };
    },
    measure: function (line) {
      var cum = [0];
      for (var i = 1; i < line.length; i++) {
        cum.push(cum[i - 1] + hav(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
      }
      return cum;
    },
    pointAt: function (line, cum, f) {
      var total = cum[cum.length - 1];
      if (!total || f <= 0) return [line[0][0], line[0][1]];
      if (f >= 1) return [line[line.length - 1][0], line[line.length - 1][1]];
      var d = f * total;
      var i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      var seg = cum[i] - cum[i - 1] || 1;
      var g = (d - cum[i - 1]) / seg;
      return [
        line[i - 1][0] + (line[i][0] - line[i - 1][0]) * g,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * g,
      ];
    },
    orderStops: function (origin, stops) {
      if (!stops || stops.length < 3) return stops ? stops.slice() : [];
      // Nearest-neighbor from origin…
      var rest = stops.slice(), out = [], cur = origin;
      while (rest.length) {
        var bi = 0, bd = Infinity;
        for (var i = 0; i < rest.length; i++) {
          var d = hav(cur[0], cur[1], rest[i].lat, rest[i].lng);
          if (d < bd) { bd = d; bi = i; }
        }
        var nx = rest.splice(bi, 1)[0];
        out.push(nx);
        cur = [nx.lat, nx.lng];
      }
      // …then 2-opt until stable (≤8 stops, cheap).
      var improved = true;
      function segd(a, b) { return hav(a[0], a[1], b[0], b[1]); }
      function pt(i) { return i < 0 ? origin : [out[i].lat, out[i].lng]; }
      while (improved) {
        improved = false;
        for (var i2 = -1; i2 < out.length - 2; i2++) {
          for (var j = i2 + 1; j < out.length - 1; j++) {
            var before = segd(pt(i2), pt(i2 + 1)) + segd(pt(j), pt(j + 1));
            var after = segd(pt(i2), pt(j)) + segd(pt(i2 + 1), pt(j + 1));
            if (after + 1 < before) {
              var seg = out.slice(i2 + 1, j + 1).reverse();
              Array.prototype.splice.apply(out, [i2 + 1, seg.length].concat(seg));
              improved = true;
            }
          }
        }
      }
      return out;
    },
  };
})();
