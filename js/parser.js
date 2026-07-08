/*
 * parser.js
 * -----------------------------------------------------------------------------
 * Pure logic: takes a Google Tag Manager container export (JSON) and produces a
 * normalized model of how dataLayer data flows into the container's tags.
 *
 * No DOM access here on purpose — this file is the analytical core and can be
 * unit-tested or reused in Node. graph.js turns the model into a graph.
 *
 * Tags are grouped into three categories the UI can show independently:
 *   'ga'    — GA4 event tags + the Google tag / GA4 config. Full transformation
 *             semantics: event-name renames, event/config parameters, user
 *             properties, event-settings variables.
 *   'html'  — Custom HTML tags. Shown by the dataLayer variables their code
 *             references and the triggers that fire them.
 *   'other' — every other tag (marketing pixels, Ads, Floodlight, templates…).
 *             Shown by the dataLayer variables its parameters reference and its
 *             triggers.
 * Custom JavaScript and lookup/regex tables are surfaced as transforms wherever
 * they sit between the dataLayer and a tag.
 */
(function (global) {
  'use strict';

  // ---- Tag type classification -------------------------------------------
  // GTM tag "type" codes. GA4 event tags carry the event-name + parameter
  // mappings; the Google-tag / config types are GA but usually emit no event of
  // their own; Custom HTML is its own category; everything else is "other".
  var GA4_EVENT_TYPES = ['gaawe'];               // GA4 Event
  var GA4_CONFIG_TYPES = ['googtag', 'gaawc'];   // Google tag / GA4 Configuration
  var HTML_TYPES = ['html'];                     // Custom HTML

  // Human-readable labels for common tag types, shown in the detail panel.
  var TAG_TYPE_LABELS = {
    html: 'Custom HTML',
    img: 'Custom Image / Pixel',
    awct: 'Google Ads Conversion',
    sp: 'Google Ads Remarketing',
    flc: 'Floodlight Counter',
    fls: 'Floodlight Sales',
    gclidw: 'Conversion Linker',
    gaawe: 'GA4 Event',
    googtag: 'Google Tag',
    gaawc: 'GA4 Configuration'
  };

  // Category a tag type belongs to: 'ga' | 'html' | 'other'.
  function tagCategory(type) {
    if (GA4_EVENT_TYPES.indexOf(type) !== -1 || GA4_CONFIG_TYPES.indexOf(type) !== -1) return 'ga';
    if (HTML_TYPES.indexOf(type) !== -1) return 'html';
    return 'other';
  }

  function typeLabel(type) {
    if (TAG_TYPE_LABELS[type]) return TAG_TYPE_LABELS[type];
    if (typeof type === 'string' && type.indexOf('cvt_') === 0) return 'Custom Template';
    return type;
  }

  // Trigger types that are not CUSTOM_EVENT map to a GTM built-in event name.
  // (These are auto-events GTM pushes to the dataLayer under the hood.)
  var TRIGGER_BUILTIN_EVENT = {
    CLICK: 'gtm.click',
    LINK_CLICK: 'gtm.linkClick',
    PAGEVIEW: 'gtm.js',
    DOM_READY: 'gtm.dom',
    WINDOW_LOADED: 'gtm.load',
    FORM_SUBMISSION: 'gtm.formSubmit',
    HISTORY_CHANGE: 'gtm.historyChange',
    SCROLL_DEPTH: 'gtm.scrollDepth',
    YOU_TUBE_VIDEO: 'gtm.video',
    ELEMENT_VISIBILITY: 'gtm.elementVisibility',
    TIMER: 'gtm.timer',
    INIT: 'gtm.init'
  };

  var VAR_REF_RE = /\{\{([^}]+)\}\}/g;

  // Heuristic for Custom HTML tags: a field/key assigned a {{variable}}, e.g.
  //   color_code: {{DLV - color}}     "value":{{DLV - price}}
  //   ?color_code={{DLV - color}}     fbq('track',{content_ids:{{DLV - ids}}})
  // Captures the field name (1) and the variable reference (2).
  var FIELD_IN_CODE_RE = /["']?([A-Za-z_$][\w$-]*)["']?\s*[:=]\s*["']?\{\{([^}]+)\}\}/g;

  // Event name inside common pixel calls in Custom HTML, e.g.
  //   fbq('track','Purchase')  fbq('trackCustom',{{DLV - ev}})  ttq.track('...')
  // Captures a literal event name (1) or a {{variable}} reference (2).
  var HTML_EVENT_RE = /(?:fbq\s*\(\s*['"](?:track|trackCustom)['"]\s*,|ttq\s*\.\s*track\s*\(|snaptr\s*\(\s*['"]track['"]\s*,|pintrk\s*\(\s*['"]track['"]\s*,)\s*(?:['"]([^'"]+)['"]|\{\{([^}]+)\}\})/i;

  // Parameter keys that commonly hold a tag's event / virtual-pageview name
  // (Meta template, Contentsquare artificial pageview, etc.).
  var EVENT_NAME_KEYS = ['eventName', 'event_name', 'standardEventName', 'customEventName',
    'eventType', 'pageName', 'virtualPageName', 'virtualPageview', 'pageview', 'screenName'];

  // ---- small helpers ------------------------------------------------------
  function getParam(entity, key) {
    if (!entity || !entity.parameter) return undefined;
    for (var i = 0; i < entity.parameter.length; i++) {
      if (entity.parameter[i].key === key) return entity.parameter[i];
    }
    return undefined;
  }
  function getParamValue(entity, key) {
    var p = getParam(entity, key);
    return p ? p.value : undefined;
  }
  function getListParam(entity, keys) {
    // keys: array of acceptable param keys (GTM has renamed these over versions)
    for (var k = 0; k < keys.length; k++) {
      var p = getParam(entity, keys[k]);
      if (p && p.list) return p.list;
    }
    return [];
  }
  function mapEntryValue(mapEntry, keys) {
    // A MAP param is { type:'MAP', map:[ {key,value}, ... ] }. Accept several
    // possible keys because GA4 tables use parameter/parameterValue while some
    // versions use name/value.
    if (!mapEntry || !mapEntry.map) return undefined;
    for (var i = 0; i < mapEntry.map.length; i++) {
      for (var k = 0; k < keys.length; k++) {
        if (mapEntry.map[i].key === keys[k]) return mapEntry.map[i].value;
      }
    }
    return undefined;
  }
  function extractRefs(str) {
    if (typeof str !== 'string') return [];
    var refs = [], m;
    VAR_REF_RE.lastIndex = 0;
    while ((m = VAR_REF_RE.exec(str)) !== null) refs.push(m[1].trim());
    return refs;
  }

  // Recursively gather every string value inside a parameter (TEMPLATE values,
  // and nested LIST -> MAP -> value structures).
  function collectParamStrings(param, out) {
    if (param == null) return;
    if (param.value != null) out.push(String(param.value));
    if (param.list) param.list.forEach(function (item) { collectParamStrings(item, out); });
    if (param.map) param.map.forEach(function (item) { collectParamStrings(item, out); });
  }

  // All distinct {{variable}} references anywhere in a tag's parameters
  // (including a Custom HTML tag's code body).
  function collectAllRefs(tag) {
    var strings = [];
    (tag.parameter || []).forEach(function (p) { collectParamStrings(p, strings); });
    var seen = {}, refs = [];
    strings.forEach(function (s) {
      extractRefs(s).forEach(function (r) { if (!seen[r]) { seen[r] = true; refs.push(r); } });
    });
    return refs;
  }

  // ---- main entry ---------------------------------------------------------
  function parse(container) {
    var version = (container && container.containerVersion) || container || {};
    var tags = version.tag || [];
    var triggers = version.trigger || [];
    var variables = version.variable || [];

    // Index variables and triggers by id and by name for fast lookup.
    var varByName = {};
    variables.forEach(function (v) { varByName[v.name] = v; });
    var trigById = {};
    triggers.forEach(function (t) { trigById[t.triggerId] = t; });

    var model = {
      meta: {
        containerName: (version.container && version.container.name) ||
          (container && container.containerVersion && container.containerVersion.container &&
            container.containerVersion.container.publicId) || 'GTM container',
        publicId: (version.container && version.container.publicId) || '',
        tagCount: tags.length,
        gaTagCount: 0,
        googleTagCount: 0,
        otherTagCount: 0,
        htmlTagCount: 0,
        eventRenameCount: 0,
        fieldRenameCount: 0,
        userPropCount: 0,
        userPropRenameCount: 0,
        settingsVarCount: 0,
        customJsCount: 0,
        tableCount: 0
      },
      events: [],          // one per GA4 event tag — the event-name transformation
      fields: [],          // one per (tag, GA field) — event/config parameter mapping
      userProps: [],       // one per (tag, user property) — user-property mapping
      settingsVars: [],    // one per Event/Config Settings variable — parsed once
      settingsVarUses: [], // {ownerId, ownerName, ownerType, varName} references
      otherTags: [],       // non-GA tags (html / other): dataLayer inputs + triggers
      warnings: []
    };

    var customJsSeen = {};
    var settingsVarSeen = {};
    var tableSeen = {};

    tags.forEach(function (tag) {
      var type = tag.type;
      if (GA4_EVENT_TYPES.indexOf(type) !== -1) {
        model.meta.gaTagCount++;
        parseGa4EventTag(tag);
      } else if (GA4_CONFIG_TYPES.indexOf(type) !== -1) {
        // Google tag / GA4 Configuration: no event of its own, but its
        // configuration parameters and user properties are sent with every
        // event, so their dataLayer -> GA4 mappings are worth graphing.
        model.meta.gaTagCount++;
        model.meta.googleTagCount++;
        parseGoogleTag(tag);
      } else if (HTML_TYPES.indexOf(type) !== -1) {
        model.meta.htmlTagCount++;
        parseOtherTag(tag, 'html');
      } else {
        model.meta.otherTagCount++;
        parseOtherTag(tag, 'other');
      }
    });

    return model;

    // ---- per-tag parsing (closures over model / lookups) ------------------
    function parseGa4EventTag(tag) {
      // --- event name transformation ---
      var dlEvents = resolveTriggerEvents(tag.firingTriggerId || []);
      var eventNameRaw = getParamValue(tag, 'eventName');
      var gaEvent = resolveEventName(eventNameRaw, dlEvents);

      var dlEventNames = dlEvents.map(function (e) { return e.eventName; });
      var isEventRename = dlEventNames.length > 0
        ? dlEventNames.indexOf(gaEvent.name) === -1
        : false;
      if (isEventRename) model.meta.eventRenameCount++;

      model.events.push({
        tagId: tag.tagId,
        tagName: tag.name,
        dlEvents: dlEvents,          // [{eventName, triggerName, kind}]
        gaEvent: gaEvent,            // {name, kind}  kind: literal|passthrough|variable
        isRename: isEventRename
      });

      // --- event parameter mappings (inline only; settings variables are
      //     linked, not inlined — see linkSettingsVariable) ---
      pushFieldRows(tag, getListParam(tag, ['eventSettingsTable', 'eventParameters']), 'event');
      linkSettingsVariable(tag.tagId, tag.name, 'tag', getParamValue(tag, 'eventSettingsVariable'));

      // --- user properties ---
      parseUserProperties(tag);
    }

    // Google tag / GA4 Configuration tag: has configuration parameters (sent on
    // every event) and can set user properties — but no event name of its own.
    function parseGoogleTag(tag) {
      pushFieldRows(tag, getListParam(tag, ['configSettingsTable', 'configParameters']), 'config');
      pushFieldRows(tag, getListParam(tag, ['eventSettingsTable', 'eventParameters']), 'event');
      linkSettingsVariable(tag.tagId, tag.name, 'tag', getParamValue(tag, 'configSettingsVariable'));
      linkSettingsVariable(tag.tagId, tag.name, 'tag', getParamValue(tag, 'eventSettingsVariable'));
      parseUserProperties(tag);
    }

    // Non-GA tag (Custom HTML or other/template). We infer named field mappings
    // the same way we do for GA — the dataLayer field/constant/etc. feeding each
    // of the tag's output fields (e.g. dataLayer "color" -> Meta Pixel
    // "color_code") — from its parameter keys, key/value tables, and (for Custom
    // HTML) "field: {{var}}" patterns in the code. Anything referenced but not
    // tied to a named field is kept as a plain input. Triggers give the events.
    function parseOtherTag(tag, category) {
      var dlEvents = resolveTriggerEvents(tag.firingTriggerId || []);
      var fields = [], usedRefs = {}, seenField = {};

      function addField(name, valueRaw) {
        if (name == null || valueRaw == null || seenField[name]) return;
        seenField[name] = true;
        var sources = resolveFieldSources(valueRaw);
        var dlNames = collectDlFieldNames(sources);
        fields.push({
          field: name,
          valueRaw: valueRaw,
          sources: sources,
          isRename: dlNames.length ? dlNames.indexOf(name) === -1 : false
        });
        extractRefs(valueRaw).forEach(function (r) { usedRefs[r] = true; });
      }

      (tag.parameter || []).forEach(function (p) {
        if (category === 'html' && p.key === 'html') return; // handled via code scan
        // A top-level parameter whose value references a variable is a field.
        if (typeof p.value === 'string' && extractRefs(p.value).length) addField(p.key, p.value);
        // Explicit key/value tables (custom parameters, query params, …).
        if (p.list) {
          p.list.forEach(function (row) {
            if (!row.map) return;
            addField(mapEntryValue(row, ['name', 'key', 'parameter']),
              mapEntryValue(row, ['value', 'parameterValue']));
          });
        }
      });

      if (category === 'html') {
        var code = getParamValue(tag, 'html') || '';
        var m; FIELD_IN_CODE_RE.lastIndex = 0;
        while ((m = FIELD_IN_CODE_RE.exec(code)) !== null) {
          addField(m[1], '{{' + m[2].trim() + '}}');
        }
      }

      // Event name (where the system has one — Meta/TikTok event, Contentsquare
      // virtual pageview, …; Google Ads / Floodlight simply have none).
      var eventName = detectEventName(tag, category, dlEvents);
      if (eventName) extractRefs(eventName.raw).forEach(function (r) { usedRefs[r] = true; });

      // Referenced variables not tied to a named field -> plain inputs.
      var extraSources = [];
      collectAllRefs(tag).forEach(function (r) {
        if (!usedRefs[r]) extraSources.push(classifyVariable(r, {}));
      });

      model.otherTags.push({
        tagId: tag.tagId,
        tagName: tag.name,
        type: tag.type,
        typeLabel: typeLabel(tag.type),
        category: category,        // 'html' | 'other'
        dlEvents: dlEvents,        // triggers -> dataLayer events
        eventName: eventName,      // {name, kind, sources, isRename} | null
        fields: fields,            // [{field, valueRaw, sources, isRename}]
        extraSources: extraSources // [{kind, name, dlFields}] un-named inputs
      });
    }

    // Best-effort event-name detection for a non-GA tag. Returns null when the
    // system has no event-name concept (Google Ads, Floodlight, …).
    function detectEventName(tag, category, dlEvents) {
      var raw = null;
      if (category === 'html') {
        var m = HTML_EVENT_RE.exec(getParamValue(tag, 'html') || '');
        HTML_EVENT_RE.lastIndex = 0;
        if (m) raw = m[1] != null ? m[1] : (m[2] != null ? '{{' + m[2].trim() + '}}' : null);
      } else {
        for (var i = 0; i < EVENT_NAME_KEYS.length && raw == null; i++) {
          var v = getParamValue(tag, EVENT_NAME_KEYS[i]);
          if (v != null && v !== '') raw = v;
        }
      }
      if (raw == null || raw === '') return null;

      var refs = extractRefs(raw);
      var dlNames = dlEvents.map(function (e) { return e.eventName; });
      if (refs.length === 0) {
        return { raw: raw, name: raw, kind: 'literal', sources: [],
          isRename: dlNames.indexOf(raw) === -1 };
      }
      // driven by a variable — a pass-through if it's the dataLayer event itself
      var pass = refs.length === 1 && (refs[0] === '_event' || refs[0] === 'Event');
      return {
        raw: raw,
        name: pass && dlEvents[0] ? dlEvents[0].eventName : raw,
        kind: pass ? 'passthrough' : 'variable',
        sources: pass ? [] : resolveFieldSources(raw),
        isRename: !pass
      };
    }

    // Push a table of parameter/value MAP rows onto model.fields for a tag.
    // scope: 'event' (event parameter) or 'config' (configuration parameter).
    function pushFieldRows(tag, rows, scope) {
      rows.forEach(function (row) {
        var gaField = mapEntryValue(row, ['parameter', 'name']);
        var valueRaw = mapEntryValue(row, ['parameterValue', 'value']);
        if (gaField == null) return;
        var sources = resolveFieldSources(valueRaw);

        var dlFieldNames = collectDlFieldNames(sources);
        var isFieldRename = dlFieldNames.length > 0
          ? dlFieldNames.indexOf(gaField) === -1
          : false;
        if (isFieldRename) model.meta.fieldRenameCount++;

        model.fields.push({
          tagId: tag.tagId,
          tagName: tag.name,
          gaField: gaField,
          valueRaw: valueRaw,
          sources: sources,          // [{kind, name, dlFields:[...], code?}]
          scope: scope,              // 'event' | 'config'
          isRename: isFieldRename
        });
      });
    }

    // Record that an owner (a tag, or another settings variable) references an
    // Event/Config Settings variable, WITHOUT inlining its contents into the
    // owner. The variable's own mappings are parsed exactly once as a standalone
    // cluster (ensureSettingsVarParsed). Inlining per-owner is what made large
    // containers explode, since one settings variable is used by many tags.
    function linkSettingsVariable(ownerId, ownerName, ownerType, raw) {
      extractRefs(raw).forEach(function (refName) {
        var v = varByName[refName];
        if (!v) return;
        model.settingsVarUses.push({
          ownerId: ownerId, ownerName: ownerName, ownerType: ownerType, varName: refName
        });
        ensureSettingsVarParsed(refName, v);
      });
    }

    // Parse a settings variable's parameter + user-property tables once into
    // model.settingsVars. Follows nested settings variables (cycle-guarded).
    function ensureSettingsVarParsed(name, v) {
      if (settingsVarSeen[name]) return;
      settingsVarSeen[name] = true;
      model.meta.settingsVarCount++;

      var entry = { name: name, fields: [], userProps: [] };
      getListParam(v, ['eventSettingsTable', 'configSettingsTable', 'eventParameters']).forEach(function (row) {
        var gaField = mapEntryValue(row, ['parameter', 'name']);
        var valueRaw = mapEntryValue(row, ['parameterValue', 'value']);
        if (gaField == null) return;
        var sources = resolveFieldSources(valueRaw);
        var isRename = isRenamed(sources, gaField);
        if (isRename) model.meta.fieldRenameCount++;
        entry.fields.push({ gaField: gaField, valueRaw: valueRaw, sources: sources, isRename: isRename });
      });
      getListParam(v, ['userProperties', 'userProperty']).forEach(function (row) {
        var propName = mapEntryValue(row, ['name', 'parameter']);
        var valueRaw = mapEntryValue(row, ['value', 'parameterValue']);
        if (propName == null) return;
        var sources = resolveFieldSources(valueRaw);
        var isRename = isRenamed(sources, propName);
        model.meta.userPropCount++;
        if (isRename) model.meta.userPropRenameCount++;
        entry.userProps.push({ propName: propName, valueRaw: valueRaw, sources: sources, isRename: isRename });
      });
      model.settingsVars.push(entry);

      // a settings variable can itself include another settings variable
      linkSettingsVariable(name, name, 'var', getParamValue(v, 'eventSettingsVariable'));
      linkSettingsVariable(name, name, 'var', getParamValue(v, 'configSettingsVariable'));
    }

    // True when none of the source dataLayer keys equals the output name.
    function isRenamed(sources, name) {
      var dl = collectDlFieldNames(sources);
      return dl.length > 0 ? dl.indexOf(name) === -1 : false;
    }

    // Parse a userProperties table. `source` is the entity holding the table
    // (tag or settings variable); `owner` is the tag the mapping belongs to.
    function parseUserProperties(source, owner) {
      owner = owner || source;
      var rows = getListParam(source, ['userProperties', 'userProperty']);
      rows.forEach(function (row) {
        var propName = mapEntryValue(row, ['name', 'parameter']);
        var valueRaw = mapEntryValue(row, ['value', 'parameterValue']);
        if (propName == null) return;
        var sources = resolveFieldSources(valueRaw);

        var dlFieldNames = collectDlFieldNames(sources);
        var isRename = dlFieldNames.length > 0
          ? dlFieldNames.indexOf(propName) === -1
          : false;
        model.meta.userPropCount++;
        if (isRename) model.meta.userPropRenameCount++;

        model.userProps.push({
          tagId: owner.tagId,
          tagName: owner.name,
          propName: propName,
          valueRaw: valueRaw,
          sources: sources,
          isRename: isRename
        });
      });
    }

    // Resolve firing triggers to the dataLayer events they listen for.
    function resolveTriggerEvents(triggerIds) {
      var out = [];
      triggerIds.forEach(function (tid) {
        var trig = trigById[tid];
        if (!trig) { out.push({ eventName: '(unknown trigger)', triggerName: tid, kind: 'unknown' }); return; }
        if (trig.type === 'CUSTOM_EVENT') {
          var names = customEventNames(trig);
          if (names.length === 0) {
            out.push({ eventName: '(any custom event)', triggerName: trig.name, kind: 'custom' });
          }
          names.forEach(function (n) {
            out.push({ eventName: n.value, triggerName: trig.name, kind: n.regex ? 'custom-regex' : 'custom' });
          });
        } else {
          var builtin = TRIGGER_BUILTIN_EVENT[trig.type] || ('(' + trig.type + ')');
          out.push({ eventName: builtin, triggerName: trig.name, kind: 'builtin' });
        }
      });
      return out;
    }

    // A CUSTOM_EVENT trigger matches on {{_event}} in its customEventFilter.
    function customEventNames(trig) {
      var res = [];
      var filters = trig.customEventFilter || [];
      filters.forEach(function (f) {
        var arg0 = null, arg1 = null;
        (f.parameter || []).forEach(function (p) {
          if (p.key === 'arg0') arg0 = p.value;
          if (p.key === 'arg1') arg1 = p.value;
        });
        // arg0 is normally {{_event}}; arg1 is the event name (or regex).
        if (arg1 != null) {
          res.push({ value: arg1, regex: (f.type && f.type.indexOf('REGEX') !== -1) });
        }
      });
      return res;
    }

    // eventName param → resolved GA event name.
    function resolveEventName(raw, dlEvents) {
      if (raw == null || raw === '') return { name: '(unset)', kind: 'literal' };
      var refs = extractRefs(raw);
      if (refs.length === 0) return { name: raw, kind: 'literal' };
      if (refs.length === 1 && (refs[0] === '_event' || refs[0] === 'Event')) {
        // pass-through: GA event name == dataLayer event name
        var first = dlEvents[0] ? dlEvents[0].eventName : raw;
        return { name: first, kind: 'passthrough' };
      }
      // event name is driven by some variable — show the variable expression.
      return { name: raw, kind: 'variable' };
    }

    // Resolve a GA field's value expression into upstream sources.
    function resolveFieldSources(valueRaw) {
      var refs = extractRefs(valueRaw);
      if (refs.length === 0) {
        // constant literal value (no variable reference at all)
        return [{ kind: 'constant', name: valueRaw == null ? '' : String(valueRaw), dlFields: [] }];
      }
      var sources = [];
      refs.forEach(function (refName) {
        sources.push(classifyVariable(refName, {}));
      });
      return sources;
    }

    // Classify a referenced variable into a source descriptor, recursing into
    // custom JS and lookup/regex tables to find the underlying dataLayer fields.
    function classifyVariable(refName, seen) {
      if (seen[refName]) {
        return { kind: 'cycle', name: refName, dlFields: [] };
      }
      seen[refName] = true;

      var v = varByName[refName];
      if (!v) {
        // Not a user variable — likely a built-in (Click Text, Page URL, ...).
        return { kind: 'builtin', name: refName, dlFields: [] };
      }

      if (v.type === 'v') {
        // Data Layer Variable → its dataLayer key.
        var dlKey = getParamValue(v, 'name') || refName;
        return { kind: 'dlfield', name: refName, dlKey: dlKey, dlFields: [dlKey] };
      }

      if (v.type === 'jsm') {
        // Custom JavaScript macro: read code, find nested variable refs.
        if (!customJsSeen[refName]) { customJsSeen[refName] = true; model.meta.customJsCount++; }
        var code = getParamValue(v, 'javascript') || '';
        var nested = extractRefs(code).map(function (n) { return classifyVariable(n, cloneSeen(seen)); });
        return {
          kind: 'customjs',
          name: refName,
          code: code,
          upstream: nested,
          dlFields: flattenDlFields(nested)
        };
      }

      if (v.type === 'smm' || v.type === 'remm') {
        // Lookup table / regex table: a common rename mechanism. Its input is a
        // variable reference; resolve that to find the underlying dataLayer key.
        if (!tableSeen[refName]) { tableSeen[refName] = true; model.meta.tableCount++; }
        var inputRaw = getParamValue(v, 'input') || '';
        var nestedT = extractRefs(inputRaw).map(function (n) { return classifyVariable(n, cloneSeen(seen)); });
        return {
          kind: v.type === 'smm' ? 'lookup-table' : 'regex-table',
          name: refName,
          input: inputRaw,
          upstream: nestedT,
          dlFields: flattenDlFields(nestedT)
        };
      }

      if (v.type === 'c') {
        return { kind: 'constant-var', name: refName, value: getParamValue(v, 'value'), dlFields: [] };
      }

      // Other variable types (URL, cookie, etc.) — treat as opaque input.
      return { kind: 'other-var', name: refName, varType: v.type, dlFields: [] };
    }

    function cloneSeen(seen) { var c = {}; for (var k in seen) c[k] = seen[k]; return c; }
    function flattenDlFields(list) {
      var out = [];
      list.forEach(function (s) { (s.dlFields || []).forEach(function (f) { if (out.indexOf(f) === -1) out.push(f); }); });
      return out;
    }
    function collectDlFieldNames(sources) {
      var out = [];
      sources.forEach(function (s) { (s.dlFields || []).forEach(function (f) { if (out.indexOf(f) === -1) out.push(f); }); });
      return out;
    }
  }

  global.GTMParser = { parse: parse };
})(typeof window !== 'undefined' ? window : this);
