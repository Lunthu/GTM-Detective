/*
 * graph.js
 * -----------------------------------------------------------------------------
 * Turns the parser model into Cytoscape elements and manages the interactive
 * graph: layout, styling, view toggles (events / fields), highlight-on-select.
 *
 * Node roles (left -> right flow):
 *   dlevent   dataLayer event name (source)
 *   dlfield   dataLayer field name (source)
 *   transform custom JS / lookup table sitting between a field and a tag
 *   tag       GA4 tag (hub)
 *   gaevent   GA4 event name (output)
 *   gafield   GA4 field name (output, scoped per tag so identical names don't merge)
 *
 * Edge classes: `rename` (name changes), `customjs`, `table`, `passthrough`.
 */
(function (global) {
  'use strict';

  function buildElements(model, opts) {
    opts = opts || {};
    // Category masters: which tag categories to render at all.
    var showGa = opts.showGa !== false;       // GA4 event tags + Google tag
    var showOther = !!opts.showOther;          // other/template tags
    var showHtml = !!opts.showHtml;            // custom HTML tags
    // GA sub-flow filters (only meaningful when showGa is on).
    var showEvents = opts.showEvents !== false;
    var showFields = opts.showFields !== false;
    var showUserProps = opts.showUserProps !== false;
    var showSettingsVars = opts.showSettingsVars !== false;

    var nodes = {};   // id -> node data (dedup)
    var edges = [];

    function addNode(id, data) {
      if (!nodes[id]) nodes[id] = Object.assign({ id: id }, data);
      return id;
    }
    function addEdge(source, target, data) {
      edges.push(Object.assign({
        id: 'e' + edges.length,
        source: source,
        target: target
      }, data || {}));
    }

    // ----- event-name flow -----
    if (showGa && showEvents) {
      model.events.forEach(function (ev) {
        var tagId = addNode('tag:' + ev.tagId, {
          role: 'tag', label: ev.tagName, tagId: ev.tagId
        });
        var gaEvId = addNode('gaevent:' + ev.gaEvent.name, {
          role: 'gaevent', label: ev.gaEvent.name
        });
        // tag -> GA event name
        addEdge(tagId, gaEvId, {
          label: 'emits',
          klass: ev.isRename ? 'rename' : 'passthrough',
          kind: 'event'
        });
        // dataLayer event(s) -> tag
        ev.dlEvents.forEach(function (dl) {
          var dlId = addNode('dlevent:' + dl.eventName, {
            role: 'dlevent', label: dl.eventName
          });
          addEdge(dlId, tagId, {
            label: dl.triggerName,
            klass: dl.kind === 'builtin' ? 'builtin' : 'trigger',
            kind: 'event'
          });
        });
      });
    }

    // ----- field flow -----
    if (showGa && showFields) {
      model.fields.forEach(function (f) {
        var tagId = addNode('tag:' + f.tagId, {
          role: 'tag', label: f.tagName, tagId: f.tagId
        });
        // GA field node is scoped per-tag so "value" on two tags stays distinct.
        var gaFieldId = addNode('gafield:' + f.tagId + ':' + f.gaField, {
          role: 'gafield', label: f.gaField
        });
        addEdge(tagId, gaFieldId, {
          label: 'sets',
          klass: f.isRename ? 'rename' : 'passthrough',
          kind: 'field'
        });

        f.sources.forEach(function (src) {
          wireSource(src, tagId, f.gaField);
        });
      });
    }

    // ----- user-property flow -----
    if (showGa && showUserProps) {
      model.userProps.forEach(function (u) {
        var tagId = addNode('tag:' + u.tagId, {
          role: 'tag', label: u.tagName, tagId: u.tagId
        });
        var upId = addNode('userprop:' + u.tagId + ':' + u.propName, {
          role: 'userprop', label: u.propName
        });
        addEdge(tagId, upId, {
          label: 'user prop',
          klass: u.isRename ? 'rename' : 'passthrough',
          kind: 'userprop'
        });
        u.sources.forEach(function (src) {
          wireSource(src, tagId, u.propName);
        });
      });
    }

    // ----- event settings variable flow -----
    if (showGa && showSettingsVars) {
      // (a) Standalone cluster, drawn once per settings variable:
      //     source(s) -> [transform] -> Settings variable -> GA4 field / user prop
      (model.settingsVars || []).forEach(function (sv) {
        var svId = addNode('settingsvar:' + sv.name, { role: 'settingsvar', label: sv.name });
        sv.fields.forEach(function (f) {
          var gaId = addNode('svfield:' + sv.name + ':' + f.gaField, { role: 'gafield', label: f.gaField });
          addEdge(svId, gaId, { label: 'sets', klass: f.isRename ? 'rename' : 'passthrough', kind: 'settings' });
          f.sources.forEach(function (src) { wireSource(src, svId, f.gaField); });
        });
        sv.userProps.forEach(function (u) {
          var upId = addNode('svuserprop:' + sv.name + ':' + u.propName, { role: 'userprop', label: u.propName });
          addEdge(svId, upId, { label: 'user prop', klass: u.isRename ? 'rename' : 'passthrough', kind: 'settings' });
          u.sources.forEach(function (src) { wireSource(src, svId, u.propName); });
        });
      });
      // (b) High-level links only: each tag (or parent settings variable) that
      //     uses a settings variable connects to it with a single edge — its
      //     contents are NOT inlined per user.
      (model.settingsVarUses || []).forEach(function (use) {
        var svId = addNode('settingsvar:' + use.varName, { role: 'settingsvar', label: use.varName });
        var ownerId = use.ownerType === 'tag'
          ? addNode('tag:' + use.ownerId, { role: 'tag', label: use.ownerName, tagId: use.ownerId })
          : addNode('settingsvar:' + use.ownerId, { role: 'settingsvar', label: use.ownerId });
        addEdge(ownerId, svId, { label: 'uses', klass: 'uses', kind: 'settings' });
      });
    }

    // ----- non-GA tag flow (custom HTML / other) -----
    // Named field mappings mirror GA (source -> tag -> output field), so renames
    // like dataLayer "color" -> pixel "color_code" show the same way. Plus each
    // tag's triggers and any un-named dataLayer inputs.
    if (showOther || showHtml) {
      (model.otherTags || []).forEach(function (t) {
        if (t.category === 'html' ? !showHtml : !showOther) return;
        var role = t.category === 'html' ? 'htmltag' : 'othertag';
        var tagId = addNode('otag:' + t.tagId, {
          role: role, label: t.tagName, tagId: t.tagId, otherType: t.typeLabel
        });
        t.dlEvents.forEach(function (dl) {
          var dlId = addNode('dlevent:' + dl.eventName, { role: 'dlevent', label: dl.eventName });
          addEdge(dlId, tagId, {
            label: dl.triggerName,
            klass: dl.kind === 'builtin' ? 'builtin' : 'trigger',
            kind: 'event'
          });
        });
        // event name the tag reports (where the system has one)
        if (t.eventName) {
          var evId = addNode('tagevent:' + t.tagId + ':' + t.eventName.name, {
            role: 'tagevent', label: t.eventName.name
          });
          addEdge(tagId, evId, {
            label: 'event', klass: t.eventName.isRename ? 'rename' : 'passthrough', kind: 'event'
          });
          t.eventName.sources.forEach(function (src) { wireSource(src, tagId, '_event'); });
        }
        t.fields.forEach(function (f) {
          var ofId = addNode('tagfield:' + t.tagId + ':' + f.field, {
            role: 'tagfield', label: f.field
          });
          addEdge(tagId, ofId, {
            label: 'sets', klass: f.isRename ? 'rename' : 'passthrough', kind: 'field'
          });
          f.sources.forEach(function (src) { wireSource(src, tagId, f.field); });
        });
        t.extraSources.forEach(function (src) { wireSource(src, tagId, t.tagId); });
      });
    }

    function wireSource(src, tagId, outputKey) {
      if (src.kind === 'dlfield') {
        var dlId = addNode('dlfield:' + src.dlKey, { role: 'dlfield', label: src.dlKey });
        addEdge(dlId, tagId, { label: src.name, klass: 'field-in', kind: 'field' });
        return;
      }
      if (src.kind === 'customjs' || src.kind === 'lookup-table' || src.kind === 'regex-table') {
        var isJs = src.kind === 'customjs';
        var tId = addNode('transform:' + src.name, {
          role: 'transform',
          label: src.name,
          transformKind: src.kind,
          code: src.code || src.input || ''
        });
        addEdge(tId, tagId, { label: 'feeds', klass: isJs ? 'customjs' : 'table', kind: 'field' });
        // upstream dataLayer fields into the transform
        (src.dlFields || []).forEach(function (dlKey) {
          var uId = addNode('dlfield:' + dlKey, { role: 'dlfield', label: dlKey });
          addEdge(uId, tId, { label: '', klass: isJs ? 'customjs' : 'table', kind: 'field' });
        });
        return;
      }
      if (src.kind === 'constant' || src.kind === 'constant-var') {
        var cId = addNode('const:' + tagId + ':' + outputKey, {
          role: 'constant', label: src.name || '(constant)'
        });
        addEdge(cId, tagId, { label: 'const', klass: 'const', kind: 'field' });
        return;
      }
      if (src.kind === 'builtin' || src.kind === 'other-var') {
        var bId = addNode('builtin:' + src.name, { role: 'builtin', label: src.name });
        addEdge(bId, tagId, { label: '', klass: 'field-in', kind: 'field' });
        return;
      }
    }

    var els = [];
    Object.keys(nodes).forEach(function (id) { els.push({ data: nodes[id] }); });
    edges.forEach(function (e) { els.push({ data: e, classes: e.klass }); });
    return els;
  }

  // Build "relation groups": one group per field-mapping row and per event, each
  // a set of node ids that belong together (input(s) -> transform -> tag -> GA
  // field, or dataLayer event(s) -> tag -> GA event). These let a click resolve
  // to just the specific relations a node participates in — so clicking one
  // dataLayer field lights up only the GA field(s) it actually feeds, not every
  // field on the shared tag. Node ids MUST mirror buildElements() exactly.
  function buildGroups(model) {
    var groups = [];
    model.fields.forEach(function (f) {
      var g = {};
      g['tag:' + f.tagId] = true;
      g['gafield:' + f.tagId + ':' + f.gaField] = true;
      addSourceIds(g, f.sources, 'tag:' + f.tagId, f.gaField);
      groups.push(g);
    });
    model.events.forEach(function (ev) {
      var g = {};
      g['tag:' + ev.tagId] = true;
      g['gaevent:' + ev.gaEvent.name] = true;
      ev.dlEvents.forEach(function (d) { g['dlevent:' + d.eventName] = true; });
      groups.push(g);
    });
    (model.userProps || []).forEach(function (u) {
      var g = {};
      g['tag:' + u.tagId] = true;
      g['userprop:' + u.tagId + ':' + u.propName] = true;
      addSourceIds(g, u.sources, 'tag:' + u.tagId, u.propName);
      groups.push(g);
    });
    // settings variable clusters + the high-level tag/var -> settings-var links
    (model.settingsVars || []).forEach(function (sv) {
      var svNodeId = 'settingsvar:' + sv.name;
      sv.fields.forEach(function (f) {
        var g = {};
        g[svNodeId] = true;
        g['svfield:' + sv.name + ':' + f.gaField] = true;
        addSourceIds(g, f.sources, svNodeId, f.gaField);
        groups.push(g);
      });
      sv.userProps.forEach(function (u) {
        var g = {};
        g[svNodeId] = true;
        g['svuserprop:' + sv.name + ':' + u.propName] = true;
        addSourceIds(g, u.sources, svNodeId, u.propName);
        groups.push(g);
      });
    });
    (model.settingsVarUses || []).forEach(function (use) {
      var g = {};
      g['settingsvar:' + use.varName] = true;
      g[(use.ownerType === 'tag' ? 'tag:' : 'settingsvar:') + use.ownerId] = true;
      groups.push(g);
    });
    // non-GA tags: one group per trigger (dataLayer event), one per named field
    // mapping (source -> tag -> output field), one per un-named input.
    (model.otherTags || []).forEach(function (t) {
      var tagNodeId = 'otag:' + t.tagId;
      t.dlEvents.forEach(function (d) {
        var g = {}; g[tagNodeId] = true; g['dlevent:' + d.eventName] = true;
        groups.push(g);
      });
      if (t.eventName) {
        var g = {};
        g[tagNodeId] = true;
        g['tagevent:' + t.tagId + ':' + t.eventName.name] = true;
        t.dlEvents.forEach(function (d) { g['dlevent:' + d.eventName] = true; });
        addSourceIds(g, t.eventName.sources, tagNodeId, '_event');
        groups.push(g);
      }
      t.fields.forEach(function (f) {
        var g = {}; g[tagNodeId] = true; g['tagfield:' + t.tagId + ':' + f.field] = true;
        addSourceIds(g, f.sources, tagNodeId, f.field);
        groups.push(g);
      });
      t.extraSources.forEach(function (src) {
        var g = {}; g[tagNodeId] = true;
        addSourceIds(g, [src], tagNodeId, t.tagId);
        groups.push(g);
      });
    });
    return groups;
  }

  // Add the node ids for a mapping's sources to a group (shared by field,
  // user-property and settings-variable groups). ownerNodeId is the full node id
  // of the owner (e.g. 'tag:1' or 'settingsvar:Base'); it scopes the constant id.
  function addSourceIds(g, sources, ownerNodeId, outputKey) {
    sources.forEach(function (src) {
      if (src.kind === 'dlfield') {
        g['dlfield:' + src.dlKey] = true;
      } else if (src.kind === 'customjs' || src.kind === 'lookup-table' || src.kind === 'regex-table') {
        g['transform:' + src.name] = true;
        (src.dlFields || []).forEach(function (k) { g['dlfield:' + k] = true; });
      } else if (src.kind === 'constant' || src.kind === 'constant-var') {
        g['const:' + ownerNodeId + ':' + outputKey] = true;
      } else if (src.kind === 'builtin' || src.kind === 'other-var') {
        g['builtin:' + src.name] = true;
      }
    });
  }

  // Any tag (GA, other, or custom HTML) acts as a hub on the radial layout.
  var HUB_SELECTOR = 'node[role="tag"], node[role="othertag"], node[role="htmltag"]';
  function isHubRole(r) { return r === 'tag' || r === 'othertag' || r === 'htmltag'; }

  // ---- radial "circle of tags" layout ------------------------------------
  // Tags are placed on a circle; every other node fans outward around the tag
  // it belongs to. Computed positions are applied via the O(n) `preset` layout
  // (no expensive iterative layout — fast and predictable on big containers).
  function radialPositions(cy) {
    var pos = {};
    var tags = cy.nodes(HUB_SELECTOR).sort(function (a, b) {
      return a.id() < b.id() ? -1 : 1;
    });
    var n = tags.length;

    if (n === 0) {
      var all = cy.nodes(), m = all.length || 1;
      all.forEach(function (node, i) {
        var a = 2 * Math.PI * i / m;
        pos[node.id()] = { x: 500 * Math.cos(a), y: 500 * Math.sin(a) };
      });
      return pos;
    }

    var slice = 2 * Math.PI / n;
    var R = Math.max(340, n * 230 / (2 * Math.PI));
    var angleOf = {};
    tags.forEach(function (t, i) {
      var a = -Math.PI / 2 + i * slice;
      angleOf[t.id()] = a;
      pos[t.id()] = { x: R * Math.cos(a), y: R * Math.sin(a) };
    });

    // Classify every non-tag node by how many tags it connects to:
    //   1 tag   -> exclusive satellite: fans neatly around that tag
    //   2+ tags -> shared: positioned by the centroid of its tags, so locally
    //              shared nodes sit between their (nearby) tags with short edges,
    //              while globally shared nodes gravitate to a compact centre ring
    //   0 tags  -> orphan (e.g. unused settings-variable cluster)
    var buckets = {}, shared = [], orphans = [];
    tags.forEach(function (t) { buckets[t.id()] = []; });
    cy.nodes().forEach(function (node) {
      if (isHubRole(node.data('role'))) return;
      var ct = connectedTags(node);
      if (ct.length === 0) orphans.push(node);
      else if (ct.length === 1) buckets[ct[0]].push(node);
      else { node.scratch('_ct', ct); shared.push(node); }
    });

    // exclusive satellites fan outward within each tag's angular slice
    tags.forEach(function (t) {
      placeFan(orderSatellites(buckets[t.id()]), angleOf[t.id()], slice, R, pos);
    });

    // shared nodes: centroid of their tags' unit vectors. |mean| (rho) is ~1
    // when the tags are clustered together, ~0 when spread around the ring.
    var globals = [];
    shared.forEach(function (node) {
      var ct = node.scratch('_ct'), sx = 0, sy = 0;
      ct.forEach(function (id) { var a = angleOf[id]; sx += Math.cos(a); sy += Math.sin(a); });
      sx /= ct.length; sy /= ct.length;
      var rho = Math.hypot(sx, sy);
      if (rho < 0.25) { globals.push(node); return; }               // widely shared
      var ang = Math.atan2(sy, sx), radius = R * Math.min(0.82, rho * 0.85);
      pos[node.id()] = { x: radius * Math.cos(ang), y: radius * Math.sin(ang) };
    });
    // widely-shared nodes on a compact inner ring -> edges read as spokes
    globals.forEach(function (node, i) {
      var a = 2 * Math.PI * i / globals.length, radius = R * 0.28;
      pos[node.id()] = { x: radius * Math.cos(a), y: radius * Math.sin(a) };
    });

    if (orphans.length) {
      var ri = R * 0.14;
      orphans.forEach(function (node, i) {
        var a = 2 * Math.PI * i / orphans.length;
        pos[node.id()] = { x: ri * Math.cos(a), y: ri * Math.sin(a) };
      });
    }
    return pos;

    // Tags this node feeds into / comes from: direct tag neighbours, plus tags
    // reached through an adjacent transform or settings variable (not through
    // another tag, which would over-count).
    function connectedTags(node) {
      var set = {};
      node.neighborhood().nodes().forEach(function (nb) {
        var r = nb.data('role');
        if (isHubRole(r)) set[nb.id()] = true;
        else if (r === 'transform' || r === 'settingsvar') {
          nb.neighborhood().nodes(HUB_SELECTOR).forEach(function (t) { set[t.id()] = true; });
        }
      });
      return Object.keys(set);
    }
  }

  // Order a tag's satellites so dataLayer-side inputs fan to one side and GA
  // outputs to the other (rough input -> output reading within each cluster).
  function orderSatellites(list) {
    var rank = {
      dlevent: 0, dlfield: 1, transform: 2, constant: 2, builtin: 2,
      settingsvar: 3, gaevent: 6, tagevent: 6, gafield: 7, tagfield: 7, userprop: 8
    };
    return list.slice().sort(function (a, b) {
      return (rank[a.data('role')] || 5) - (rank[b.data('role')] || 5);
    });
  }

  // Lay a tag's satellites in concentric arc-rows just outside its circle
  // position, staying within (a fraction of) its angular slice.
  function placeFan(sats, a0, slice, R, pos) {
    var k = sats.length;
    if (!k) return;
    var arc = slice * 0.86, margin = 130, rowGap = 95, colSpacing = 90;
    var placed = 0, ring = 0;
    while (placed < k && ring < 60) {
      var radius = R + margin + ring * rowGap;
      var maxCols = Math.max(1, Math.floor((arc * radius) / colSpacing));
      var cols = Math.min(maxCols, k - placed);
      for (var c = 0; c < cols; c++) {
        var frac = cols === 1 ? 0.5 : c / (cols - 1);
        var ang = a0 - arc / 2 + frac * arc;
        pos[sats[placed].id()] = { x: radius * Math.cos(ang), y: radius * Math.sin(ang) };
        placed++;
      }
      ring++;
    }
  }

  var STYLE = [
    { selector: 'node', style: {
      'label': 'data(label)',
      'font-size': 11,
      'color': '#1f2328',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': 130,
      // Hide labels when zoomed out (overview) — they'd be an unreadable,
      // expensive smear on big containers. They reappear on zoom-in / focus.
      'min-zoomed-font-size': 8,
      'width': 'label', 'height': 'label',
      'padding': 10,
      'shape': 'round-rectangle',
      'border-width': 1.5,
      'border-color': '#d0d7de',
      'background-color': '#ffffff'
    }},
    { selector: 'node[role="dlevent"]', style: { 'background-color': '#e6f4ea', 'border-color': '#2f9e44', 'shape': 'round-tag' }},
    { selector: 'node[role="dlfield"]', style: { 'background-color': '#e7f5ff', 'border-color': '#1c7ed6' }},
    { selector: 'node[role="tag"]', style: { 'background-color': '#e7ecfd', 'border-color': '#3b5bdb', 'border-width': 2, 'font-weight': 'bold' }},
    { selector: 'node[role="othertag"]', style: { 'background-color': '#eceef1', 'border-color': '#5f6b7a', 'border-width': 2, 'font-weight': 'bold' }},
    { selector: 'node[role="htmltag"]', style: { 'background-color': '#fff0f0', 'border-color': '#e03131', 'border-width': 2, 'font-weight': 'bold' }},
    { selector: 'node[role="gaevent"]', style: { 'background-color': '#fff1de', 'border-color': '#f08c00', 'shape': 'round-tag' }},
    { selector: 'node[role="tagevent"]', style: { 'background-color': '#fff0e6', 'border-color': '#f76707', 'shape': 'round-tag' }},
    { selector: 'node[role="gafield"]', style: { 'background-color': '#fbf2da', 'border-color': '#c9820a' }},
    { selector: 'node[role="tagfield"]', style: { 'background-color': '#e6fcf5', 'border-color': '#0ca678' }},
    { selector: 'node[role="userprop"]', style: { 'background-color': '#fde8ef', 'border-color': '#d6336c', 'shape': 'round-tag' }},
    { selector: 'node[role="settingsvar"]', style: { 'background-color': '#e0f7fa', 'border-color': '#0891b2', 'border-width': 2, 'shape': 'hexagon', 'font-weight': 'bold' }},
    { selector: 'node[role="transform"]', style: { 'background-color': '#f0e9fb', 'border-color': '#7048e8', 'shape': 'diamond', 'text-max-width': 110 }},
    { selector: 'node[role="constant"]', style: { 'background-color': '#eef1f4', 'border-color': '#868e96', 'shape': 'ellipse' }},
    { selector: 'node[role="builtin"]', style: { 'background-color': '#f2ece0', 'border-color': '#8a6d3b' }},

    { selector: 'edge', style: {
      'width': 1.5,
      'line-color': '#adb5bd',
      'target-arrow-color': '#adb5bd',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'opacity': 0.5,
      'font-size': 9,
      'color': '#57606a',
      'label': 'data(label)',
      // Same as nodes: edge labels only paint once zoomed in enough to read.
      'min-zoomed-font-size': 8,
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.9,
      'text-background-padding': 2
    }},
    { selector: 'edge.rename', style: { 'line-color': '#e8590c', 'target-arrow-color': '#e8590c', 'width': 2.5 }},
    { selector: 'edge.customjs', style: { 'line-color': '#7048e8', 'target-arrow-color': '#7048e8', 'line-style': 'dashed', 'width': 2 }},
    { selector: 'edge.table', style: { 'line-color': '#2f9e44', 'target-arrow-color': '#2f9e44', 'line-style': 'dashed', 'width': 2 }},
    { selector: 'edge.trigger', style: { 'line-color': '#3b5bdb', 'target-arrow-color': '#3b5bdb' }},
    { selector: 'edge.uses', style: { 'line-color': '#0891b2', 'target-arrow-color': '#0891b2', 'line-style': 'dotted', 'width': 2 }},

    { selector: '.dim', style: { 'opacity': 0.15 }},
    { selector: '.highlight', style: { 'opacity': 1 }},
    { selector: 'node.highlight', style: { 'border-width': 3 }}
  ];

  function GTMGraph(container) {
    this.cy = cytoscape({
      container: container,
      style: STYLE,
      wheelSensitivity: 0.25,
      minZoom: 0.15,
      maxZoom: 3
    });
    this._bindSelection();
    var self = this;
    // Refit when the container/window resizes so the graph never gets clipped.
    window.addEventListener('resize', function () {
      self.cy.resize();
      self.cy.fit(undefined, 40);
    });
    this._moved = this.cy.collection(); // nodes currently displaced by a focus
    window.__gtmGraph = this; // debug handle
  }

  GTMGraph.prototype.render = function (model, opts) {
    var els = buildElements(model, opts);
    this.cy.elements().remove();
    this.cy.add(els);
    this._moved = this.cy.collection();
    this._indexGroups(model);
    this.layout();
    return els.length;
  };

  // Index each node id -> the relation groups it belongs to, for fast lookup on
  // click. A node can belong to many groups (e.g. a tag, or a dataLayer field
  // reused across mappings).
  GTMGraph.prototype._indexGroups = function (model) {
    var groups = buildGroups(model);
    var index = {};
    groups.forEach(function (g) {
      Object.keys(g).forEach(function (nid) {
        (index[nid] = index[nid] || []).push(g);
      });
    });
    this._nodeToGroups = index;
  };

  // Resolve a clicked node to the precise set of related elements: the union of
  // every relation group it participates in. Falls back to immediate neighbours
  // if the node is in no group.
  GTMGraph.prototype._relatedElements = function (node) {
    var groups = this._nodeToGroups[node.id()];
    var cy = this.cy;
    if (!groups || !groups.length) {
      var nb = node.closedNeighborhood();
      return { nodes: nb.nodes(), all: nb };
    }
    // Nodes: union of every group's node set.
    var ids = {};
    groups.forEach(function (g) { Object.keys(g).forEach(function (nid) { ids[nid] = true; }); });
    var nodes = cy.nodes().filter(function (n) { return ids[n.id()]; });
    // Edges between two highlighted nodes are shown, EXCEPT settings-variable
    // boundary edges (anything touching a settingsvar, plus the "uses" link),
    // which stay a deliberate black box: those are shown only when a *single*
    // group of the clicked node ties both ends together. Without that carve-out,
    // clicking a tag would light a dataLayer field -> settings-variable edge just
    // because that field also feeds the tag; with it applied to *all* edges,
    // legitimate tag-field edges between co-highlighted nodes would wrongly dim.
    var edges = cy.edges().filter(function (e) {
      var s = e.source().id(), t = e.target().id();
      if (!ids[s] || !ids[t]) return false;
      var boundary = e.data('klass') === 'uses' ||
        e.source().data('role') === 'settingsvar' || e.target().data('role') === 'settingsvar';
      if (!boundary) return true;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i][s] && groups[i][t]) return true;
      }
      return false;
    });
    return { nodes: nodes, all: nodes.union(edges) };
  };

  GTMGraph.prototype.layout = function () {
    var self = this;
    var pos = radialPositions(this.cy);
    var l = this.cy.layout({
      name: 'preset',
      positions: function (node) { return pos[node.id()] || { x: 0, y: 0 }; },
      fit: true,
      padding: 40
    });
    // Remember each node's home position so focused nodes can return to it.
    l.one('layoutstop', function () { self._saveHomePositions(); });
    l.run();
  };

  GTMGraph.prototype._saveHomePositions = function () {
    this.cy.nodes().forEach(function (n) {
      n.scratch('_home', { x: n.position('x'), y: n.position('y') });
    });
  };

  // Animate (or snap) the given nodes back to their saved home positions.
  GTMGraph.prototype._restoreHome = function (nodes, animate) {
    nodes.forEach(function (n) {
      var h = n.scratch('_home');
      if (!h) return;
      n.stop();
      if (animate) {
        n.animate({ position: { x: h.x, y: h.y } },
          { duration: 400, easing: 'ease-in-out-cubic' });
      } else {
        n.position({ x: h.x, y: h.y });
      }
    });
  };

  GTMGraph.prototype._bindSelection = function () {
    var self = this;
    this.cy.on('tap', 'node', function (evt) {
      self.highlightNeighborhood(evt.target);
      if (self.onSelect) self.onSelect(evt.target.data());
    });
    this.cy.on('tap', function (evt) {
      if (evt.target === self.cy) {
        self.clearHighlight();
        self.resetView();
        if (self.onSelect) self.onSelect(null);
      }
    });
  };

  // Highlight the full upstream+downstream chain through a node, compact just
  // those related nodes into a clean left-to-right flow, and glide the camera to
  // frame them — so on a big container the chain becomes readable in isolation.
  // Nodes from a previous selection animate back home first.
  GTMGraph.prototype.highlightNeighborhood = function (node) {
    // Resolve the precise relations this node belongs to (see _relatedElements):
    // a tag lights up its whole neighbourhood; a field/constant/transform lights
    // up only the specific mapping(s) it takes part in.
    var related = this._relatedElements(node);
    var chain = related.all;
    var chainNodes = related.nodes;

    // Send previously-focused nodes that aren't part of this chain back home.
    this._restoreHome(this._moved.difference(chainNodes), true);
    this._moved = chainNodes;

    this.cy.elements().addClass('dim').removeClass('highlight');
    chain.removeClass('dim').addClass('highlight');

    // Snapshot where the chain nodes currently are (start of the animation).
    var start = {};
    chainNodes.forEach(function (n) { var p = n.position(); start[n.id()] = { x: p.x, y: p.y }; });

    // Compute a *compact* dagre layout for just the chain, synchronously and
    // with natural (non-distorted) spacing. This is the key to readability on
    // big containers: the chain is packed tight regardless of how far apart the
    // nodes sit in the full graph.
    chain.layout({
      name: 'dagre', rankDir: 'LR',
      nodeSep: 20, rankSep: 80, edgeSep: 8,
      fit: false, animate: false
    }).run();

    // Recenter that compact result on the clicked node's home position so the
    // chain collapses toward where the user clicked rather than jumping away.
    var bb = chainNodes.boundingBox();
    var anchor = node.scratch('_home') || { x: bb.x1 + bb.w / 2, y: bb.y1 + bb.h / 2 };
    var dx = anchor.x - (bb.x1 + bb.w / 2);
    var dy = anchor.y - (bb.y1 + bb.h / 2);

    // Move nodes back to their start, then animate them into the compact target.
    chainNodes.forEach(function (n) {
      var p = n.position();
      var target = { x: p.x + dx, y: p.y + dy };
      n.position(start[n.id()]);
      n.stop().animate({ position: target }, { duration: 450, easing: 'ease-in-out-cubic' });
    });

    // Frame the compact target box precisely (computed, not read from current
    // positions — so the camera zooms into the packed chain, not the sprawl).
    this._fitBoxAnimated(
      { x1: bb.x1 + dx, y1: bb.y1 + dy, w: bb.w, h: bb.h }, 80, 450
    );
  };

  // Animate the viewport to frame a model-space bounding box, clamped to the
  // configured zoom range. Used to frame a compact chain by its known target box.
  GTMGraph.prototype._fitBoxAnimated = function (box, padding, duration) {
    var cy = this.cy;
    var vw = cy.width(), vh = cy.height();
    var bw = box.w || (box.x2 - box.x1), bh = box.h || (box.y2 - box.y1);
    var zoom = Math.min((vw - 2 * padding) / bw, (vh - 2 * padding) / bh);
    zoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), zoom));
    var cx = box.x1 + bw / 2, cyc = box.y1 + bh / 2;
    cy.stop();
    cy.animate(
      { zoom: zoom, pan: { x: vw / 2 - zoom * cx, y: vh / 2 - zoom * cyc } },
      { duration: duration, easing: 'ease-in-out-cubic' }
    );
  };

  GTMGraph.prototype.clearHighlight = function () {
    this.cy.elements().removeClass('dim').removeClass('highlight');
  };

  // Send focused nodes home and animate the camera back out to the whole graph.
  GTMGraph.prototype.resetView = function () {
    this._restoreHome(this._moved, true);
    this._moved = this.cy.collection();
    this.cy.stop();
    this.cy.animate(
      { fit: { eles: this.cy.elements(), padding: 40 } },
      { duration: 450, easing: 'ease-in-out-cubic' }
    );
  };

  // Search: dim everything except nodes/chains matching a text query.
  GTMGraph.prototype.filterByText = function (q) {
    if (!q) { this.clearHighlight(); return 0; }
    q = q.toLowerCase();
    var matches = this.cy.nodes().filter(function (n) {
      return (n.data('label') || '').toLowerCase().indexOf(q) !== -1;
    });
    if (matches.length === 0) { this.cy.elements().addClass('dim'); return 0; }
    var keep = matches;
    matches.forEach(function (n) { keep = keep.union(n.successors()).union(n.predecessors()); });
    this.cy.elements().addClass('dim').removeClass('highlight');
    keep.removeClass('dim').addClass('highlight');
    return matches.length;
  };

  // Show only rename chains.
  GTMGraph.prototype.showRenamesOnly = function (on) {
    if (!on) { this.clearHighlight(); return; }
    var renameEdges = this.cy.edges('.rename');
    var keep = renameEdges;
    renameEdges.forEach(function (e) {
      keep = keep.union(e.connectedNodes());
      keep = keep.union(e.source().predecessors()).union(e.target().successors());
    });
    this.cy.elements().addClass('dim');
    keep.removeClass('dim');
  };

  GTMGraph.prototype.fit = function () { this.cy.fit(undefined, 40); };
  GTMGraph.prototype.exportPng = function () {
    return this.cy.png({ full: true, scale: 2, bg: '#ffffff' });
  };

  global.GTMGraph = GTMGraph;
})(typeof window !== 'undefined' ? window : this);
