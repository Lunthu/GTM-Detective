# GTM Detective

Scans a **Google Tag Manager container export (JSON)** and visualizes how
**dataLayer event names and fields are transformed on their way into Google
Analytics 4** — the renames that make GA reports disagree with what you pushed
to the dataLayer.

It answers two questions at a glance:

1. **Event-name renames** — a trigger fires on dataLayer event `click`, but the
   GA4 tag sends `click_on_component`.
2. **Field renames / derivations** — the dataLayer carries `color_name`, but the
   GA4 tag maps it to `color`; or a **Custom JavaScript** variable / **Lookup
   Table** derives a GA field from one or more dataLayer fields.

Everything runs **locally in your browser** — the container JSON never leaves
your machine.

## Usage

Open `index.html` in a browser. It loads with an embedded demo container so you
can see it work immediately. Then:

- **Load container JSON** (button) or **drag-and-drop** your own GTM export
  anywhere on the page.
- **Click a node** to isolate its relations, compact them into a readable flow,
  and zoom in. Precision depends on what you click:
  - a **dataLayer field / constant / transform** lights up only the specific GA4
    field(s) it feeds (via its tag), not the tag's other fields;
  - a **GA4 field** lights up only the dataLayer field(s) / custom JS / table
    that feed it;
  - a **GA4 tag** lights up its whole neighbourhood (event + all field mappings).

  Details (tag mappings, trigger, raw `{{variable}}` expression, Custom JS
  source) appear in the side panel. Click empty space to reset.
- **Search** to isolate an event / field / tag by name.
- **Renames only** dims everything except chains where a name actually changes.
- Toggle **Event names** / **Event fields** to focus one flow.
- **Export PNG** for documentation.

> Loading from `file://` works out of the box. If your browser blocks anything,
> serve the folder: `python -m http.server` then open `http://localhost:8000`.
> (`python serve.py 4199` is the same but with no-cache headers, handy while
> editing the app so reloads always pick up changes.)

### Layout

The overview is a **radial "circle of tags"**: tags sit on a ring, each tag's own
dataLayer sources and GA outputs fan outward around it, and fields shared across
many tags gravitate to the centre (so they read as spokes, not a tangle of chords
across the graph). Node/edge labels are hidden when zoomed out and reappear as you
zoom in or click a node to focus its chain.

### Getting a container export from GTM

GTM → **Admin** → **Export Container** → pick the workspace/version → downloads a
`.json`. That is the file this tool reads.

## What it reads (and ignores)

| Tag type | Handled as |
|---|---|
| `gaawe` | **GA4 Event** — event name, event parameters, user properties |
| `googtag`, `gaawc` | **Google tag / GA4 config** — configuration parameters + user properties (no event name of its own) |
| everything else (`html`, `img`, `awct`, `sp`, `flc`, …) | **Ignored** (listed in the panel so you can confirm) |

Per tag, these mapping tables are parsed:

- **Event parameters** (`eventSettingsTable`) — inline on the tag.
- **Configuration parameters** (`configSettingsTable`) on Google tags.
- **User properties** (`userProperties`) → their own GA4 output type.

**Event Settings variables** (`gtes`, referenced via `eventSettingsVariable`)
are handled as shared objects rather than inlined into every tag — otherwise one
variable used by dozens of tags would explode the graph. Each is drawn once as a
standalone cluster (`source → Event Settings variable → GA4 fields / user
properties`), and every tag that uses it links to it with a single dotted "uses"
edge. Nested settings variables link variable-to-variable. Toggle the whole set
with **Event settings**.

Variables followed when resolving a value:

- **Data Layer Variable** (`v`) → the underlying dataLayer key
- **Custom JavaScript** (`jsm`) → flagged as a JS transform; nested `{{...}}`
  references are traced back to their dataLayer fields (purple dashed edges)
- **Lookup / RegEx Table** (`smm` / `remm`) → flagged as a table transform; its
  input variable is traced back (green dashed edges)

## Visual encoding

- **Node roles**: dataLayer event, dataLayer field, GA4 tag (hub), GA4 event,
  GA4 field, GA4 user property, transform (diamond), constant, built-in/other.
- **Edges**: orange = a rename (name changes), purple dashed = custom JS,
  green dashed = lookup table, blue = trigger, grey = direct / pass-through.
- Toggle **Event names / Event fields / User properties** to focus a flow;
  config-scope parameters are marked `cfg` in the detail panel.

## Privacy

GTM Detective runs **entirely in your browser** — your container data never
leaves your device (there's a **Privacy** button in the app with the full text).

- **No upload / no backend.** The container JSON is read and analysed locally by
  the page's JavaScript. There is no server to receive it.
- **No storage.** It lives only in memory for the session; nothing is written to
  disk, cookies, or local storage. Reloading the tab discards it.
- **No tracking.** No analytics, cookies, or trackers; no personal data collected.
- **Third-party assets.** Cytoscape.js + dagre load from public CDNs on first
  open — plain file downloads that carry none of your data. Host them locally to
  run fully offline.
- **Exports.** PNGs are generated in-browser and saved directly to your device.

Because everything is local, you can safely analyse production containers with
proprietary tracking logic.

## Project layout

```
index.html               app shell + CDN libs (Cytoscape.js + dagre)
css/styles.css           styling
js/parser.js             container JSON -> transformation model (pure, testable)
js/graph.js              model -> interactive Cytoscape graph
js/app.js                UI wiring (load, filters, detail panel)
data/sample-container.js embedded demo container
```

`js/parser.js` has no DOM dependencies and can be run in Node:

```bash
node -e 'global.window=global;require("./data/sample-container.js");require("./js/parser.js");console.log(JSON.stringify(window.GTMParser.parse(window.SAMPLE_CONTAINER).meta))'
```

## Known limitations / next steps

- GA4 only (UA `ua` tags are labeled and ignored). The parser is structured so
  UA support can be added later.
- Custom JS field tracing is based on the `{{variable}}` references inside the
  code, not full JS data-flow analysis — a script that reads
  `dataLayer`/`google_tag_manager` directly (without a `{{DLV}}`) won't have that
  dependency detected. Such cases are still shown as a custom-JS transform node.
- Custom HTML **tags** that push to the dataLayer are ignored (only Custom JS
  *variables* feeding GA fields are traced).
- Library assets (Cytoscape/dagre) load from CDN, so the very first load needs
  internet; the container data itself is always processed locally.
