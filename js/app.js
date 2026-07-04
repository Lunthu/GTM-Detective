/*
 * app.js
 * -----------------------------------------------------------------------------
 * UI wiring: load container (sample / file / drag-drop), run parser, render
 * graph, update stats, filters, and the selection detail panel.
 */
(function () {
  'use strict';

  var graph, currentModel;

  function $(id) { return document.getElementById(id); }

  function init() {
    graph = new GTMGraph($('cy'));
    graph.onSelect = renderDetail;

    // View toggles
    ['toggleEvents', 'toggleFields', 'toggleUserProps', 'toggleSettingsVars'].forEach(function (id) {
      $(id).addEventListener('change', rerender);
    });
    $('search').addEventListener('input', function (e) {
      var n = graph.filterByText(e.target.value.trim());
      $('searchCount').textContent = e.target.value.trim() ? (n + ' match' + (n === 1 ? '' : 'es')) : '';
    });
    $('renamesOnly').addEventListener('change', function (e) {
      graph.showRenamesOnly(e.target.checked);
    });
    $('btnFit').addEventListener('click', function () { graph.fit(); });
    $('btnPng').addEventListener('click', exportPng);
    $('btnSample').addEventListener('click', loadSample);

    // Privacy modal
    $('btnPrivacy').addEventListener('click', function () { $('privacyOverlay').hidden = false; });
    $('privacyClose').addEventListener('click', function () { $('privacyOverlay').hidden = true; });
    $('privacyOverlay').addEventListener('click', function (e) {
      if (e.target === $('privacyOverlay')) $('privacyOverlay').hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $('privacyOverlay').hidden = true;
    });

    // File input + drag/drop
    $('fileInput').addEventListener('change', function (e) {
      if (e.target.files[0]) readFile(e.target.files[0]);
    });
    var drop = document.body;
    ['dragover', 'dragenter'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); document.body.classList.add('dragging'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); document.body.classList.remove('dragging'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    loadSample();
  }

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        loadContainer(JSON.parse(reader.result), file.name);
      } catch (err) {
        alert('Could not parse "' + file.name + '" as JSON:\n' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function loadSample() {
    loadContainer(window.SAMPLE_CONTAINER, 'sample-container (demo)');
  }

  function loadContainer(json, sourceName) {
    try {
      currentModel = GTMParser.parse(json);
    } catch (err) {
      alert('Failed to analyze container: ' + err.message);
      return;
    }
    $('sourceName').textContent = sourceName;
    updateStats(currentModel);
    renderIgnored(currentModel);
    rerender();
    renderDetail(null);
  }

  function rerender() {
    if (!currentModel) return;
    var count = graph.render(currentModel, {
      showEvents: $('toggleEvents').checked,
      showFields: $('toggleFields').checked,
      showUserProps: $('toggleUserProps').checked,
      showSettingsVars: $('toggleSettingsVars').checked
    });
    $('renamesOnly').checked = false;
    if (count === 0) $('detail').innerHTML = '<p class="muted">No GA4 transformations found in this container.</p>';
  }

  function updateStats(m) {
    var s = m.meta;
    $('stats').innerHTML = '' +
      stat(s.gaTagCount, 'GA4 tags') +
      stat(s.googleTagCount, 'Google tags') +
      stat(s.eventRenameCount, 'event renames', 'rename') +
      stat(s.fieldRenameCount, 'field renames', 'rename') +
      stat(s.userPropCount, 'user properties', 'userprop') +
      stat(s.customJsCount, 'custom JS', 'js') +
      stat(s.tableCount, 'lookup tables', 'table') +
      stat(s.ignoredTagCount, 'ignored tags', 'muted');
  }
  function stat(n, label, cls) {
    return '<div class="stat ' + (cls || '') + '"><span class="num">' + n + '</span>' +
      '<span class="lbl">' + label + '</span></div>';
  }

  function renderIgnored(m) {
    if (!m.ignoredTags.length) { $('ignored').innerHTML = ''; return; }
    var rows = m.ignoredTags.map(function (t) {
      return '<li><span class="tag-type">' + esc(t.typeLabel) + '</span> ' + esc(t.name) + '</li>';
    }).join('');
    $('ignored').innerHTML = '<details><summary>' + m.ignoredTags.length +
      ' non-GA tags ignored</summary><ul>' + rows + '</ul></details>';
  }

  function renderDetail(data) {
    var el = $('detail');
    if (!data) {
      el.innerHTML = '<p class="muted">Click any node to inspect its transformation chain. ' +
        'Orange edges = a rename. Purple dashed = custom JS. Green dashed = lookup table.</p>';
      return;
    }
    var html = '<h3>' + esc(data.label) + '</h3>';
    html += '<p class="role">' + roleLabel(data.role) + '</p>';

    if (data.role === 'tag') {
      var ev = currentModel.events.filter(function (e) { return e.tagId === data.tagId; })[0];
      var fields = currentModel.fields.filter(function (f) { return f.tagId === data.tagId; });
      if (ev) {
        html += '<div class="kv"><b>dataLayer event(s):</b> ' +
          ev.dlEvents.map(function (d) { return esc(d.eventName); }).join(', ') + '</div>';
        html += '<div class="kv"><b>GA4 event:</b> ' + esc(ev.gaEvent.name) +
          (ev.isRename ? ' <span class="pill rename">renamed</span>' : '') + '</div>';
      }
      if (fields.length) {
        html += '<h4>Field mappings</h4><table class="map"><tr><th>GA field</th><th>from</th></tr>';
        fields.forEach(function (f) {
          var scopePill = f.scope === 'config' ? ' <span class="pill cfg">cfg</span>' : '';
          html += '<tr><td>' + esc(f.gaField) + scopePill +
            (f.isRename ? ' <span class="pill rename">R</span>' : '') +
            '</td><td class="mono">' + esc(f.valueRaw) + '</td></tr>';
        });
        html += '</table>';
      }
      var uprops = currentModel.userProps.filter(function (u) { return u.tagId === data.tagId; });
      if (uprops.length) {
        html += '<h4>User properties</h4><table class="map"><tr><th>Property</th><th>from</th></tr>';
        uprops.forEach(function (u) {
          html += '<tr><td>' + esc(u.propName) + (u.isRename ? ' <span class="pill rename">R</span>' : '') +
            '</td><td class="mono">' + esc(u.valueRaw) + '</td></tr>';
        });
        html += '</table>';
      }
      var uses = (currentModel.settingsVarUses || []).filter(function (u) {
        return u.ownerType === 'tag' && u.ownerId === data.tagId;
      });
      if (uses.length) {
        html += '<div class="kv"><b>Uses settings variable:</b> ' +
          uses.map(function (u) { return esc(u.varName); }).join(', ') + '</div>';
      }
    } else if (data.role === 'settingsvar') {
      var sv = (currentModel.settingsVars || []).filter(function (s) { return s.name === data.label; })[0];
      html += '<p class="muted">Event Settings variable — shared parameter set, ' +
        'defined once and reused by the tags that reference it.</p>';
      if (sv && sv.fields.length) {
        html += '<h4>Parameters</h4><table class="map"><tr><th>GA field</th><th>from</th></tr>';
        sv.fields.forEach(function (f) {
          html += '<tr><td>' + esc(f.gaField) + (f.isRename ? ' <span class="pill rename">R</span>' : '') +
            '</td><td class="mono">' + esc(f.valueRaw) + '</td></tr>';
        });
        html += '</table>';
      }
      if (sv && sv.userProps.length) {
        html += '<h4>User properties</h4><table class="map"><tr><th>Property</th><th>from</th></tr>';
        sv.userProps.forEach(function (u) {
          html += '<tr><td>' + esc(u.propName) + (u.isRename ? ' <span class="pill rename">R</span>' : '') +
            '</td><td class="mono">' + esc(u.valueRaw) + '</td></tr>';
        });
        html += '</table>';
      }
      var usedBy = (currentModel.settingsVarUses || []).filter(function (u) { return u.varName === data.label; });
      if (usedBy.length) {
        html += '<div class="kv"><b>Used by ' + usedBy.length + ':</b> ' +
          usedBy.map(function (u) { return esc(u.ownerName); }).join(', ') + '</div>';
      }
    } else if (data.role === 'transform') {
      html += '<p class="muted">' + (data.transformKind === 'customjs' ? 'Custom JavaScript variable' :
        data.transformKind === 'lookup-table' ? 'Lookup Table variable' : 'RegEx Table variable') + '</p>';
      html += '<pre class="mono">' + esc(data.code || '') + '</pre>';
    } else if (data.role === 'dlevent' || data.role === 'dlfield') {
      html += '<p class="muted">Source from the dataLayer.</p>';
    } else if (data.role === 'gaevent' || data.role === 'gafield') {
      html += '<p class="muted">Value delivered to Google Analytics 4.</p>';
    } else if (data.role === 'userprop') {
      html += '<p class="muted">User property set on Google Analytics 4.</p>';
    }
    el.innerHTML = html;
  }

  function exportPng() {
    var uri = graph.exportPng();
    var a = document.createElement('a');
    a.href = uri;
    a.download = 'gtm-detective.png';
    a.click();
  }

  function roleLabel(role) {
    return {
      dlevent: 'dataLayer event', dlfield: 'dataLayer field', tag: 'GA4 tag',
      gaevent: 'GA4 event', gafield: 'GA4 field', transform: 'Transform',
      constant: 'Constant', builtin: 'Built-in / other variable',
      userprop: 'GA4 user property', settingsvar: 'Event Settings variable'
    }[role] || role;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
