# cytoscape-libavoid – Entwicklerdokumentation

Version 0.1.0 · für Cytoscape.js ≥ 3.2 · libavoid-js 0.5.0-beta.5

`cytoscape-libavoid` ist eine Cytoscape.js-Erweiterung, die Kanten mit
[libavoid](https://www.adaptagrams.org/documentation/libavoid.html) routet,
einer C++-Bibliothek für hindernisvermeidendes Kantenrouting. Sie läuft als
WebAssembly im Browser und in Node.js. Das Plugin ist für
Materialfluss- und Sankey-Diagramme gedacht: Pfeile im Taxi-Stil, die um Knoten
herumführen und deren Breite eine Menge darstellt.

---

## Inhalt

1. [Funktionsumfang](#1-funktionsumfang)
2. [Paketinhalt](#2-paketinhalt)
3. [Installation und Einbindung](#3-installation-und-einbindung)
4. [Die WebAssembly-Datei](#4-die-webassembly-datei)
5. [Schnellstart](#5-schnellstart)
6. [Optionen](#6-optionen)
7. [Daten an Knoten und Kanten](#7-daten-an-knoten-und-kanten)
8. [API-Referenz](#8-api-referenz)
9. [Events](#9-events)
10. [Wie das Plugin arbeitet](#10-wie-das-plugin-arbeitet)
11. [Rezepte](#11-rezepte)
12. [Performance](#12-performance)
13. [Fehlersuche](#13-fehlersuche)
14. [Demo](#14-demo)
15. [Entwicklung](#15-entwicklung)
16. [Lizenz](#16-lizenz)

---

## 1. Funktionsumfang

- **Orthogonales Routing** (nur waagerechte und senkrechte Segmente) oder
  **Polyline-Routing** (beliebige Winkel). Knoten werden als Hindernisse
  umfahren.
- **Zwei Port-Modi:**
  - `auto`: Jeder Knoten hat einen Anschlusspunkt pro Seite, libavoid wählt
    die günstigste Seite.
  - `sankey`: Jede Kante bekommt einen eigenen Anschluss an der Ausgangsseite
    der Quelle und der Eingangsseite des Ziels. Die Anschlüsse werden nach
    Kantenbreite gestapelt und nach der Lage des Gegenknotens sortiert, damit
    sich Flüsse direkt am Knoten nicht kreuzen.
- **Nudging:** Parallel laufende Segmente werden auseinandergeschoben, der
  Abstand richtet sich automatisch nach der breitesten Kante.
- **Abgerundete Ecken**, optional.
- **Live-Routing:** Beim Hinzufügen, Entfernen, Verschieben und bei
  Datenänderungen wird automatisch neu geroutet, auf Wunsch auch während des
  Ziehens.
- **Nicht-invasiv:** Die Routen werden als Style-Bypass gesetzt. Farbe, Pfeile,
  Opazität usw. aus dem Stylesheet bleiben erhalten. `destroy()` stellt den
  Ausgangszustand wieder her.
- **Routing-Kern ohne Cytoscape:** `routeGraph()` arbeitet auf einem einfachen
  Datenmodell und lässt sich mit anderen Renderern oder serverseitig nutzen.

## 2. Paketinhalt

```
cytoscape-libavoid/
├── dist/
│   ├── cytoscape-libavoid.esm.js    ES-Modul-Bundle (enthält libavoid-js)
│   ├── cytoscape-libavoid.umd.js    Bundle für <script>-Tags, globale Variable cytoscapeLibavoid
│   ├── *.map                        Source Maps
│   └── libavoid.wasm                libavoid als WebAssembly (~480 kB)
├── src/
│   ├── index.js                     Cytoscape-Erweiterung, LibavoidRouting, loadLibavoid
│   ├── routing.js                   Routing-Kern (routeGraph, computeSankeyPorts, simplify)
│   ├── edge-style.js                Umrechnung Route → Cytoscape-Segment-Style
│   └── umd.js                       Einstiegspunkt des UMD-Bundles
├── demo/
│   ├── index.html                   Interaktive Demo (Materialfluss)
│   └── vendor/cytoscape.min.js      Cytoscape für die Demo (nur im ZIP)
├── docs/DOKUMENTATION.md            dieses Dokument
├── docs/LIZENZ.md                   lizenzrechtliche Hinweise (LGPL)
├── licenses/                        Lizenztexte (LGPL-2.1, Cytoscape MIT)
├── THIRD-PARTY-NOTICES.md           verwendete Fremdkomponenten
├── scripts/build.mjs                Build (esbuild)
├── scripts/serve.mjs                Mini-Webserver für die Demo
├── test/routing.test.mjs            Tests (node:test)
├── LICENSE                          MIT-Lizenz des Plugin-Codes
├── package.json
└── README.md                        Kurzfassung (englisch)
```

## 3. Installation und Einbindung

Das Paket ist nicht auf npm veröffentlicht. Es gibt drei Wege, es
einzubinden.

### 3a. Als lokales npm-Paket (Bundler wie Vite, webpack, Rollup, esbuild)

```sh
# Ordner aus dem ZIP z. B. nach ./vendor/cytoscape-libavoid entpacken
npm install ./vendor/cytoscape-libavoid
npm install cytoscape            # Peer-Dependency, falls noch nicht vorhanden
```

Dabei wird `libavoid-js` als Abhängigkeit mitinstalliert. Der Import zeigt auf
`src/index.js`, der Bundler Ihres Projekts übernimmt das Bündeln.

```js
import cytoscape from 'cytoscape';
import cytoscapeLibavoid from 'cytoscape-libavoid';

cytoscape.use(cytoscapeLibavoid);
```

Kopieren Sie zusätzlich die `.wasm`-Datei in Ihre statischen Assets, siehe
[Abschnitt 4](#4-die-webassembly-datei).

### 3b. Als `<script>`-Tag ohne Build-Werkzeug (UMD)

```html
<script src="cytoscape.min.js"></script>
<script src="lib/cytoscape-libavoid.umd.js"></script>
<!-- libavoid.wasm liegt in lib/ direkt neben dem Bundle -->
```

Ist `window.cytoscape` beim Laden bereits vorhanden, registriert sich das
Plugin selbst. Wird Cytoscape erst danach geladen, registrieren Sie es von Hand:

```js
cytoscape.use(cytoscapeLibavoid);
```

Die globale Variable `cytoscapeLibavoid` ist die Registrierungsfunktion. Sie
trägt zusätzlich alle Exporte als Eigenschaften, z. B.
`cytoscapeLibavoid.loadLibavoid` oder `cytoscapeLibavoid.routeGraph`.

### 3c. Als ES-Modul ohne Bundler

```html
<script type="module">
  import cytoscape from './lib/cytoscape.esm.min.mjs';
  import cytoscapeLibavoid from './lib/cytoscape-libavoid.esm.js';
  cytoscape.use(cytoscapeLibavoid);
</script>
```

`libavoid.wasm` muss neben `cytoscape-libavoid.esm.js` liegen.

### Node.js

```js
import cytoscape from 'cytoscape';
import cytoscapeLibavoid from 'cytoscape-libavoid';
cytoscape.use(cytoscapeLibavoid);
```

In Node.js wird die `.wasm`-Datei automatisch aus `node_modules/libavoid-js`
geladen.

## 4. Die WebAssembly-Datei

libavoid ist C++-Code, der als `libavoid.wasm` ausgeliefert wird. Die Datei
wird beim ersten Aufruf von `cy.libavoid()` asynchron geladen, danach im
Speicher gehalten und von allen Cytoscape-Instanzen der Seite gemeinsam
genutzt.

| Einbindung | Wo muss die `.wasm` liegen? | `wasmUrl` nötig? |
|---|---|---|
| `dist/cytoscape-libavoid.umd.js` | im selben Ordner wie das Bundle | nein |
| `dist/cytoscape-libavoid.esm.js` | im selben Ordner wie das Bundle | nein |
| eigener Bundler (`import 'cytoscape-libavoid'`) | beliebig, z. B. `public/` | **ja** |
| Node.js | – | nein |

Beim eigenen Bundler kopieren Sie die Datei einmalig (oder per Build-Skript):

```sh
cp node_modules/libavoid-js/dist/libavoid.wasm public/libavoid.wasm
```

```js
cy.libavoid({ wasmUrl: '/libavoid.wasm' });
```

Hinweise:

- Die Seite muss über HTTP(S) ausgeliefert werden. Von `file://` lädt der
  Browser keine WebAssembly-Dateien.
- Der Server sollte die Datei mit `Content-Type: application/wasm` ausliefern.
- Bei einer strengen Content-Security-Policy muss `script-src` den Wert
  `'wasm-unsafe-eval'` enthalten.
- Lädt Ihre Anwendung libavoid-js schon an anderer Stelle, geben Sie die
  Instanz direkt mit: `cy.libavoid({ avoidLib: AvoidLib.getInstance() })`.

## 5. Schnellstart

```js
import cytoscape from 'cytoscape';
import cytoscapeLibavoid from 'cytoscape-libavoid';

cytoscape.use(cytoscapeLibavoid);

const cy = cytoscape({
  container: document.getElementById('cy'),
  layout: { name: 'preset' },          // Positionen aus den Elementen übernehmen
  elements: [
    { data: { id: 'lager', label: 'Rohlager' }, position: { x: 0, y: 100 } },
    { data: { id: 'saege', label: 'Säge' },     position: { x: 250, y: 0 } },
    { data: { id: 'fraese', label: 'Fräse' },   position: { x: 250, y: 200 } },
    { data: { id: 'f1', source: 'lager', target: 'saege',  menge: 18 } },
    { data: { id: 'f2', source: 'lager', target: 'fraese', menge: 10 } },
  ],
  style: [
    { selector: 'node', style: { shape: 'round-rectangle', width: 90, height: 60, label: 'data(label)' } },
    {
      selector: 'edge',
      style: {
        width: 'data(menge)',            // Breite = Menge, wird für das Stapeln genutzt
        'line-color': '#d9822b',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#d9822b',
        'curve-style': 'taxi',           // Anzeige, bis die erste Route fertig ist
      },
    },
  ],
});

const routing = cy.libavoid({
  ports: 'sankey',
  flowDirection: 'right',
  cornerRadius: 6,
  wasmUrl: '/libavoid.wasm',
});

await routing.ready;                   // ab hier sind alle Kanten geroutet
```

## 6. Optionen

Alle Optionen sind optional. Sie werden beim Aufruf von `cy.libavoid(options)`
übergeben und lassen sich später mit `routing.setOptions()` ändern.

### Routing

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `routingType` | `'orthogonal' \| 'polyline'` | `'orthogonal'` | `orthogonal`: nur waagerechte und senkrechte Segmente. `polyline`: beliebige Winkel. |
| `ports` | `'auto' \| 'sankey'` | `'auto'` | `auto`: ein Anschluss pro Knotenseite, libavoid wählt die Seite. `sankey`: eigener Anschluss je Kante, gestapelt nach Breite (siehe [10.2](#102-sankey-ports)). |
| `flowDirection` | `'right' \| 'left' \| 'down' \| 'up'` | `'right'` | Nur bei `sankey`: Hauptflussrichtung. Bei `right` verlassen Kanten die Quelle rechts und erreichen das Ziel links. |
| `portSpacing` | `number` (px) | `2` | Nur bei `sankey`: Abstand zwischen gestapelten Kanten an einer Knotenseite. |
| `shapeBufferDistance` | `number` (px) | `12` | Mindestabstand der Routen zu Knoten. |
| `idealNudgingDistance` | `number \| 'auto'` | `'auto'` | Abstand zwischen parallel laufenden Segmenten. `auto` = Breite der breitesten Kante + `portSpacing`, mindestens 4. |
| `nudgeConnectedSegments` | `boolean \| 'auto'` | `'auto'` | Auch Segmente auseinanderschieben, die direkt an einem Knoten enden. `auto` = an bei `ports: 'auto'`, aus bei `sankey` (dort liegen die Ports schon fest). |
| `routingParameters` | `object` | `{}` | Rohe libavoid-`RoutingParameter`, z. B. `{ crossingPenalty: 200, segmentPenalty: 50 }`. Unbekannte Namen werfen einen Fehler. |
| `routingOptions` | `object` | `{}` | Rohe libavoid-`RoutingOption`, z. B. `{ nudgeSharedPathsWithCommonEndPoint: true }`. Unbekannte Namen werfen einen Fehler. |

Mögliche `routingParameters` (libavoid): `segmentPenalty`, `anglePenalty`,
`crossingPenalty`, `clusterCrossingPenalty`, `fixedSharedPathPenalty`,
`portDirectionPenalty`, `shapeBufferDistance`, `idealNudgingDistance`,
`reverseDirectionPenalty`.

Mögliche `routingOptions` (libavoid):
`nudgeOrthogonalSegmentsConnectedToShapes`,
`improveHyperedgeRoutesMovingJunctions`, `penaliseOrthogonalSharedPathsAtConnEnds`,
`nudgeOrthogonalTouchingColinearSegments`,
`performUnifyingNudgingPreprocessingStep`,
`improveHyperedgeRoutesMovingAddingAndDeletingJunctions`,
`nudgeSharedPathsWithCommonEndPoint`.

> `performUnifyingNudgingPreprocessingStep` ist im Plugin standardmäßig
> **aus**, siehe [Performance](#12-performance).

### Auswahl und Darstellung

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `edges` | Selektor | `'edge'` | Welche Kanten geroutet werden. Andere Kanten bleiben unverändert. |
| `obstacles` | Selektor | `'node:childless'` | Welche Knoten Hindernisse und mögliche Endpunkte sind. Compound-Eltern zählen standardmäßig nicht dazu. |
| `includeLabels` | `boolean` | `false` | Knotenbeschriftungen gehören mit zum Hindernis. |
| `edgeWidth` | `(edge) => number` | `e => e.numericStyle('width')` | Liefert die Breite einer Kante für Stapeln und Nudging. Nützlich, wenn die angezeigte Breite nicht der Fluss-Breite entsprechen soll. |
| `cornerRadius` | `number` (px) | `0` | `0` = spitze Ecken (`curve-style: segments`), `> 0` = abgerundete Ecken (`round-segments`). |

### Verhalten

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `live` | `boolean` | `true` | Bei Änderungen am Graphen automatisch neu routen. Bei `false` routen Sie selbst mit `routing.route()`. |
| `rerouteOnDrag` | `boolean` | `true` | Nur bei `live`: auch während des Ziehens routen. Bei `false` erst beim Loslassen. |

### Laden

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `wasmUrl` | `string` | – | URL von `libavoid.wasm`, siehe [Abschnitt 4](#4-die-webassembly-datei). Wirkt nur beim ersten Laden der Seite. |
| `avoidLib` | `object` | – | Bereits geladene libavoid-js-Instanz (`AvoidLib.getInstance()`). Überspringt das Laden. |

## 7. Daten an Knoten und Kanten

| Feld | Element | Werte | Wirkung |
|---|---|---|---|
| `data(sourceSide)` | Kante | `'top' \| 'right' \| 'bottom' \| 'left'` | Nur bei `sankey`: Seite, an der die Kante die Quelle verlässt. Überschreibt `flowDirection`. |
| `data(targetSide)` | Kante | wie oben | Nur bei `sankey`: Seite, an der die Kante das Ziel erreicht. |

Beispiel: ein Rücklauf, der oben aus dem Knoten austritt und oben wieder
eintritt.

```js
{ data: { id: 'ruecklauf', source: 'qs', target: 'saege', sourceSide: 'top', targetSide: 'top' } }
```

Sonst liest das Plugin nur Geometrie (Bounding Box, Position) und die
Kantenbreite (über `edgeWidth`).

## 8. API-Referenz

### 8.1 Registrierung

#### `cytoscape.use(cytoscapeLibavoid)`

Registriert die Core-Methode `cy.libavoid()`. Mehrfaches Aufrufen schadet
nicht.

### 8.2 `cy.libavoid([options])` → `LibavoidRouting`

| Aufruf | Ergebnis |
|---|---|
| `cy.libavoid(options)` | Erstellt eine neue Routing-Instanz. Eine vorhandene wird vorher mit `destroy()` beendet. |
| `cy.libavoid()` | Gibt die vorhandene Instanz zurück oder erstellt eine mit Standardoptionen. |

Pro Cytoscape-Instanz gibt es höchstens eine Routing-Instanz.

### 8.3 Klasse `LibavoidRouting`

Wird normalerweise über `cy.libavoid()` erzeugt. Direkt geht es mit
`new LibavoidRouting(cy, options)`, dann aber ohne Verwaltung über
`cy.libavoid()`.

#### Eigenschaften

| Eigenschaft | Typ | Beschreibung |
|---|---|---|
| `ready` | `Promise<LibavoidRouting>` | Erfüllt sich, sobald libavoid geladen ist und der erste Routing-Lauf fertig ist. Wird abgelehnt, wenn die `.wasm` nicht geladen werden kann. |
| `options` | `object` | Aktuelle Optionen (Standardwerte und eigene Werte zusammengeführt). Nur lesen, ändern über `setOptions()`. |
| `routes` | `Map<string, Point[]>` | Ergebnis des letzten Laufs: Kanten-ID → Punkte. |
| `cy` | Core | Die zugehörige Cytoscape-Instanz. |

`Point` ist `{ x: number, y: number }` in Modellkoordinaten. Der erste Punkt
liegt am Rand der Quelle, der letzte am Rand des Ziels.

#### `route()` → `Map<string, Point[]>`

Routet alle passenden Kanten sofort und synchron, setzt die Styles und löst
`avoidrouted` aus. Wirft einen Fehler, wenn `ready` noch nicht erfüllt ist.
Bei `live: true` müssen Sie `route()` normalerweise nicht selbst aufrufen.

#### `scheduleRoute()`

Plant einen Routing-Lauf für den nächsten Animation-Frame. Mehrere Aufrufe im
selben Frame führen zu genau einem Lauf. Diese Methode nutzt auch das
Live-Routing intern.

#### `getRoute(edge)` → `Point[] | undefined`

Gibt die Route einer Kante zurück (Kantenelement oder ID). Für Kanten, die
nicht geroutet wurden, kommt `undefined` zurück.

```js
const pts = routing.getRoute('f1');
const laenge = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
```

#### `setOptions(options)` → `this`

Führt die übergebenen Optionen mit den aktuellen zusammen und routet sofort
neu. Ein Wechsel von `live` bindet die Event-Listener an oder löst sie.
`wasmUrl` und `avoidLib` wirken nach dem ersten Laden nicht mehr.

```js
routing.setOptions({ ports: 'auto', cornerRadius: 0 });
```

#### `model()` → `{ nodes, edges }`

Liefert das Datenmodell, das an den Routing-Kern geht (siehe
[8.5](#85-routing-kern-ohne-cytoscape)). Hilfreich zum Debuggen.

#### `destroy()`

Beendet das Routing: Listener werden entfernt, die gesetzten Style-Bypässe
gelöscht und die Kanten zeigen wieder ihren Stylesheet-Stil. Danach gibt
`cy.libavoid()` eine neue Instanz zurück.

### 8.4 Weitere Exporte

```js
import cytoscapeLibavoid, {
  LibavoidRouting, defaults, loadLibavoid,
  routeGraph, computeSankeyPorts, simplify,
  routeToEdgeStyle, edgeStyleToPoints,
} from 'cytoscape-libavoid';
```

| Export | Beschreibung |
|---|---|
| `default` | Registrierungsfunktion für `cytoscape.use()` |
| `LibavoidRouting` | Klasse, siehe 8.3 |
| `defaults` | Standardoptionen (Objekt, nicht verändern) |
| `loadLibavoid(wasmUrl?)` → `Promise<Avoid>` | Lädt libavoid einmalig und gibt die Instanz zurück. Weitere Aufrufe liefern dasselbe Promise. Nach einem Fehler wird beim nächsten Aufruf neu versucht. |
| `routeGraph(Avoid, model, options)` | Routing-Kern, siehe 8.5 |
| `computeSankeyPorts(model, options)` | Berechnet nur die Sankey-Anschlüsse, siehe 8.5 |
| `simplify(points)` | Rundet Koordinaten auf 3 Nachkommastellen und entfernt doppelte und kollineare Punkte |
| `routeToEdgeStyle(points, srcPos, tgtPos, cornerRadius?)` | Wandelt eine Route in ein Cytoscape-Style-Objekt um, siehe 10.3 |
| `edgeStyleToPoints(style, srcPos, tgtPos)` | Umkehrung von `routeToEdgeStyle` |

### 8.5 Routing-Kern ohne Cytoscape

`routeGraph` kennt Cytoscape nicht. Sie können es mit anderen Renderern
(SVG, Canvas, D3) oder serverseitig nutzen.

```js
import { loadLibavoid, routeGraph } from 'cytoscape-libavoid';

const Avoid = await loadLibavoid();
const routes = routeGraph(Avoid, {
  nodes: [
    { id: 'a', x: 0,   y: 0, w: 60, h: 40 },   // x/y = Mittelpunkt
    { id: 'b', x: 300, y: 0, w: 60, h: 40 },
    { id: 'wand', x: 150, y: 0, w: 40, h: 200 },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', width: 4 }],
}, { routingType: 'orthogonal' });

routes.get('ab');
// [{x:0,y:-20}, {x:0,y:-112}, {x:300,y:-112}, {x:300,y:-20}]
// oben aus a heraus, über die Wand, oben in b hinein
```

**Modell**

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `nodes[].id` | ja | eindeutige ID |
| `nodes[].x`, `.y` | ja | Mittelpunkt |
| `nodes[].w`, `.h` | ja | Breite, Höhe |
| `edges[].id` | ja | eindeutige ID |
| `edges[].source`, `.target` | ja | Knoten-IDs |
| `edges[].width` | nein | Breite für Stapeln und Nudging (Standard 0) |
| `edges[].sourceSide`, `.targetSide` | nein | erzwungene Seite bei `sankey` |

Schleifen (Quelle = Ziel) und Kanten mit unbekannten Endpunkten werden
übersprungen. Optionen wie in [Abschnitt 6](#6-optionen) (nur der Teil
„Routing“).

Für jeden Aufruf baut `routeGraph` einen neuen libavoid-Router auf und gibt
danach den gesamten WebAssembly-Speicher wieder frei.

**`computeSankeyPorts(model, { flowDirection, portSpacing })`** gibt
`Map<edgeId, { source: { side, offset }, target: { side, offset } }>` zurück.
`offset` ist die relative Position (0 bis 1) entlang der Knotenseite.

## 9. Events

| Event | Ziel | Extra-Parameter | Wann |
|---|---|---|---|
| `avoidrouted` | `cy` | `{ edges, routingMs, totalMs }` | nach jedem Routing-Lauf |

- `edges`: Anzahl gerouteter Kanten
- `routingMs`: Zeit in libavoid
- `totalMs`: inklusive Setzen der Styles

```js
cy.on('avoidrouted', (evt, info) => {
  console.log(`${info.edges} Kanten in ${info.totalMs.toFixed(1)} ms`);
});
```

Bei `live: true` hört das Plugin auf diese Cytoscape-Events:

| Event | Selektor | Grund |
|---|---|---|
| `add`, `remove`, `data` | alle Elemente | Graph oder Daten geändert |
| `class`, `style` | Knoten | Knotengröße kann sich ändern |
| `class` | Kanten | Kantenbreite kann sich ändern |
| `position` | Knoten | Verschieben (beim Ziehen nur bei `rerouteOnDrag`) |
| `free` | Knoten | Ziehen beendet |

Alle Events eines Frames werden zu einem Lauf zusammengefasst. Ein Layout mit
vielen Positionsänderungen löst also nur wenige Läufe aus.

## 10. Wie das Plugin arbeitet

### 10.1 Ablauf eines Routing-Laufs

1. `model()` sammelt alle sichtbaren Knoten, die zu `obstacles` passen, mit
   ihrer Bounding Box, und alle sichtbaren Kanten aus `edges`, deren beide
   Endpunkte Hindernisse sind.
2. `routeGraph()` legt in libavoid für jeden Knoten ein Rechteck an, erzeugt
   die Anschlusspunkte (Ports) und verbindet sie, dann wird geroutet.
3. Jede Route wird vereinfacht und in einen Cytoscape-Style umgerechnet.
4. Die Styles werden in einem `cy.batch()` als Bypass gesetzt.
5. `avoidrouted` wird ausgelöst.

Bei jedem Lauf wird der komplette Graph neu geroutet. Ein Lauf ist meist so
schnell, dass das auch beim Ziehen flüssig bleibt (siehe
[Performance](#12-performance)).

### 10.2 Sankey-Ports

Im Modus `sankey` gilt für jede Knotenseite:

1. Alle Kanten, die diese Seite nutzen, werden nach der Lage des Gegenknotens
   quer zur Flussrichtung sortiert (bei `right`: nach dessen y-Koordinate).
2. Die Kanten werden in dieser Reihenfolge lückenlos gestapelt. Jede belegt
   ihre Breite, dazwischen liegt `portSpacing`. Der Stapel sitzt mittig auf der
   Seite.
3. Ist der Stapel länger als die Seite, wird er proportional gestaucht.
4. Jede Kante bekommt einen exklusiven Anschluss in der Mitte ihres Bandes.

So entsteht das typische Sankey-Bild: Flüsse treffen ohne Lücke aufeinander
und kreuzen sich nicht direkt am Knoten.

### 10.3 Darstellung in Cytoscape

Cytoscape kennt keine absoluten Kantenpunkte. Das Plugin rechnet jede Route
deshalb in diese Style-Eigenschaften um:

```
curve-style:       segments | round-segments
edge-distances:    endpoints
source-endpoint:   <dx>px <dy>px    (relativ zur Knotenmitte)
target-endpoint:   <dx>px <dy>px
segment-weights:   w1 w2 …          (Anteil entlang der Strecke Start → Ende)
segment-distances: d1 d2 …          (senkrechter Abstand zu dieser Strecke)
segment-radii, radius-type          (nur bei cornerRadius > 0)
```

Die Umrechnung ist exakt (`edgeStyleToPoints` ist die Umkehrung).

Daraus folgt:

- Diese Eigenschaften setzt das Plugin als **Bypass**. Eigene Werte dafür im
  Stylesheet werden überdeckt, alle anderen Kanten-Styles wirken weiter.
- Setzen Sie im Stylesheet trotzdem einen `curve-style`, z. B. `taxi`. Den
  sieht man, bis die erste Route berechnet ist.
- Pfeilspitzen sitzen genau am Knotenrand.

## 11. Rezepte

### Nur bestimmte Kanten routen

```js
cy.libavoid({ edges: 'edge.fluss', obstacles: 'node.station, node.hindernis' });
```

### Reine Hindernisse

Jeder Knoten aus `obstacles` ist ein Hindernis, auch wenn keine Kante an ihm
hängt, etwa eine Säule in einem Hallenlayout.

### Manuell routen statt live

```js
const routing = cy.libavoid({ live: false });
await routing.ready;
// … viele Änderungen …
routing.route();
```

### Nach einem Layout

Bei `live: true` passiert das automatisch, die Positionsänderungen werden pro
Frame zusammengefasst. Bei `live: false`:

```js
cy.layout({ name: 'dagre' }).run();
cy.one('layoutstop', () => routing.route());
```

### Flussbreite unabhängig von der angezeigten Breite

```js
cy.libavoid({ ports: 'sankey', edgeWidth: (e) => e.data('menge') * 0.5 });
```

### Weniger Kreuzungen, weniger Knicke

```js
cy.libavoid({ routingParameters: { crossingPenalty: 200, segmentPenalty: 50 } });
```

### React

```jsx
import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import cytoscapeLibavoid from 'cytoscape-libavoid';

cytoscape.use(cytoscapeLibavoid);

export function Flussdiagramm({ elements }) {
  const ref = useRef(null);
  useEffect(() => {
    const cy = cytoscape({ container: ref.current, elements, layout: { name: 'preset' } });
    const routing = cy.libavoid({ ports: 'sankey', wasmUrl: '/libavoid.wasm' });
    return () => {
      routing.destroy();              // erst das Routing beenden …
      cy.destroy();                   // … dann Cytoscape
    };
  }, [elements]);
  return <div ref={ref} style={{ width: '100%', height: 600 }} />;
}
```

### Routen exportieren (z. B. als SVG)

```js
const d = (pts) => 'M' + pts.map((p) => `${p.x},${p.y}`).join('L');
const pfade = [...routing.routes].map(([id, pts]) => `<path id="${id}" d="${d(pts)}"/>`);
```

## 12. Performance

Gemessen in Node.js 24 auf einem Graphen mit 64 Knoten und 112 Kanten, jeweils
ein vollständiger Routing-Lauf:

| Modus | Zeit |
|---|---|
| `ports: 'auto'` | ~50–60 ms |
| `ports: 'sankey'` | ~80–140 ms |
| `routingType: 'polyline'` | ~450–700 ms |
| Demo (10 Knoten, 13 Kanten, Browser) | ~15 ms |

Die libavoid-Option `performUnifyingNudgingPreprocessingStep` ist
standardmäßig ausgeschaltet. Eingeschaltet steigt die Zeit für denselben
Graphen auf 3,4 s (`auto`) bzw. 16 s (`sankey`), dafür gibt es etwas weniger
Knicke. Bei kleinen Graphen ohne Live-Ziehen können Sie sie wieder
einschalten:

```js
cy.libavoid({ routingOptions: { performUnifyingNudgingPreprocessingStep: true } });
```

Weitere Hebel bei großen Graphen:

- `rerouteOnDrag: false`: nur beim Loslassen neu routen
- bei `orthogonal` bleiben: `polyline` ist deutlich langsamer (siehe Tabelle)
- über `edges` und `obstacles` nur den nötigen Teil des Graphen routen

## 13. Fehlersuche

| Problem | Ursache und Lösung |
|---|---|
| `ready` wird abgelehnt, 404 auf `libavoid.wasm` | Datei liegt nicht neben dem Bundle bzw. `wasmUrl` stimmt nicht. Den Pfad im Netzwerk-Tab der Browser-Entwicklertools prüfen. |
| Fehler beim Laden von der Festplatte | Seite wurde über `file://` geöffnet. Über einen Webserver ausliefern (z. B. `node scripts/serve.mjs`). |
| `CompileError` oder CSP-Meldung zu WebAssembly | `'wasm-unsafe-eval'` in `script-src` der Content-Security-Policy ergänzen. |
| `not ready yet, await routing.ready first` | `route()` wurde vor dem Laden aufgerufen. Erst `await routing.ready`. |
| Alle Knoten liegen auf (0, 0), Kanten haben keine Route | Ohne `layout` setzt Cytoscape den `null`-Layout ein, der alle Knoten auf (0, 0) legt. `layout: { name: 'preset' }` oder ein echtes Layout angeben. |
| Eine Kante wird nicht geroutet | Ein Endpunkt passt nicht zu `obstacles` (z. B. ein Compound-Knoten bei `node:childless`), ein Element ist unsichtbar, oder es ist eine Schleife. Mit `routing.model()` prüfen, was ankommt. |
| Kanten laufen durch Beschriftungen | `includeLabels: true` |
| Kanten liegen zu dicht am Knoten | `shapeBufferDistance` erhöhen |
| Sankey-Bänder überlappen | Knotenseite zu kurz, die Bänder werden gestaucht. Knoten größer machen oder `edgeWidth` verkleinern. |
| Unbekannter Parameter- oder Optionsname | Schreibweise mit den Listen in [Abschnitt 6](#6-optionen) vergleichen. |
| Node-Prozess (Tests) beendet sich nicht | Am Ende `cy.destroy()` aufrufen. |

## 14. Demo

`demo/index.html` zeigt einen Materialfluss mit 9 Stationen, einem reinen
Hindernis (QS) und 13 Flüssen. Die Kantenbreite entspricht der Menge in
t/Tag.

**Starten** (Node.js ≥ 18 nötig, aber keine weiteren Pakete):

```sh
node scripts/serve.mjs          # im Paketordner
# → http://localhost:8080/demo/
# anderer Port: PORT=3000 node scripts/serve.mjs  (PowerShell: $env:PORT=3000; node scripts/serve.mjs)
```

Die Demo braucht einen Webserver, weil der Browser `.wasm` nicht von
`file://` lädt. Jeder andere statische Server geht genauso
(`npx serve`, `python -m http.server`), wenn er im Paketordner gestartet wird.

**Bedienung**

| Element | Wirkung |
|---|---|
| Ports | `sankey` / `auto` |
| Routing | `orthogonal` / `polyline` |
| Fluss | `flowDirection` |
| Eckradius | `cornerRadius` 0–20 px |
| beim Ziehen routen | `rerouteOnDrag` |
| + Hindernis | fügt einen Knoten an zufälliger Stelle ein, die Kanten weichen sofort aus |
| Knoten ziehen | Live-Routing |

Unten rechts zeigt die Demo die Werte aus dem Event `avoidrouted`.

Der Code der Demo ist bewusst kurz gehalten und eignet sich als Vorlage für
eine eigene Einbindung per `<script>`-Tag.

## 15. Entwicklung

```sh
npm install
npm test          # 8 Tests (node:test), inkl. Integrationstest mit headless Cytoscape
npm run build     # erzeugt dist/ (ESM, UMD, Source Maps, libavoid.wasm)
npm run demo      # Build + Demo-Server auf http://localhost:8080/demo/
```

Aufbau des Quellcodes:

- `src/routing.js`: Routing-Kern. Kennt nur das einfache Modell und libavoid.
- `src/edge-style.js`: reine Geometrie, Route ↔ Cytoscape-Style.
- `src/index.js`: Cytoscape-Anbindung (Modell aus `cy` erzeugen, Styles
  setzen, Events, Laden der `.wasm`).
- `src/umd.js`: Einstieg für das `<script>`-Bundle, registriert sich
  automatisch.

Wichtig beim Arbeiten mit libavoid-js: Jedes mit `new` erzeugte Objekt liegt im
WebAssembly-Speicher und muss mit `.delete()` freigegeben werden.
`routeGraph` erledigt das im `finally`-Block. Objekte, die dem Router gehören
(Shapes, Pins, Connectors), werden mit `router.delete()` freigegeben.

## 16. Lizenz

Der Plugin-Code steht unter der **MIT-Lizenz** (`LICENSE`).

libavoid und libavoid-js stehen unter **LGPL-2.1-or-later**. Die Bundles in
`dist/` enthalten libavoid-js. Wer eine Anwendung mit dem Plugin weitergibt,
wozu auch eine öffentliche Webanwendung zählt, muss die LGPL-Pflichten
erfüllen. Was das konkret bedeutet, was im Paket schon erledigt ist und was
noch offen ist, steht in **[LIZENZ.md](LIZENZ.md)**.
