# cytoscape-libavoid – Entwicklerdokumentation

Version 0.1.0 · für Cytoscape.js ≥ 3.2 · libavoid-js 0.5.0-beta.5

`cytoscape-libavoid` ist eine Cytoscape.js-Erweiterung, die Kanten mit
[libavoid](https://www.adaptagrams.org/documentation/libavoid.html) routet,
einer C++-Bibliothek für hindernisvermeidendes Kantenrouting. Sie läuft als
WebAssembly im Browser und in Node.js. Typischer Einsatz sind Materialfluss-
und Prozessdiagramme: Pfeile im Taxi-Stil, die um Knoten herumführen und an
eigenen Andockpunkten (Docking Ports) an den Knoten ansetzen.

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
  - `docking`: Jede Kante bekommt einen eigenen Andockpunkt (Docking Port) an
    der Ausgangsseite der Quelle und der Eingangsseite des Ziels. Die Ports
    werden nach Kantenbreite gestapelt und nach der Lage des Gegenknotens
    sortiert, damit sich Kanten direkt am Knoten nicht kreuzen.
- **Nudging:** Parallel laufende Segmente werden auseinandergeschoben, der
  Abstand richtet sich automatisch nach der breitesten Kante.
- **Abgerundete Ecken**, optional.
- **Live-Routing:** Beim Hinzufügen, Entfernen, Verschieben und bei
  Datenänderungen wird automatisch neu geroutet, auf Wunsch auch während des
  Ziehens.
- **Nicht-invasiv:** Die Routen werden als Style-Bypass gesetzt. Farbe, Pfeile,
  Opazität usw. aus dem Stylesheet bleiben erhalten. `destroy()` stellt den
  Ausgangszustand wieder her.
- **Routing ohne Cytoscape:** Die Klasse `EdgeRouter` arbeitet auf einem
  einfachen Datenmodell und lässt sich mit anderen Renderern oder serverseitig
  nutzen.

## 2. Paketinhalt

```
cytoscape-libavoid/
├── src/                             das Plugin (TypeScript), zum Kopieren in andere Projekte
│   ├── index.ts                     Plugin-Wrapper: Registrierung, cy.libavoid(), Klasse LibavoidRouting
│   ├── routing.ts                   Routing-Logik: Klasse EdgeRouter, Docking Ports, simplify
│   ├── libavoid.ts                  libavoid-Anbindung: loadLibavoid, Klasse LibavoidRouter
│   ├── edge-style.ts                Route → Cytoscape-Style, Klasse EdgeStyler
│   ├── routing.worker.ts            Einstieg für das optionale Routing im Web Worker
│   ├── libavoid-js.d.ts             Ersatz für die fehlerhaften Typen von libavoid-js
│   └── README.md                    Einbindungsanleitung (englisch)
├── demo/
│   ├── index.html                   Interaktive Demo (Materialfluss)
│   └── main.ts                      Demo-Code, nutzt src/ wie ein fremdes Projekt
├── bench/
│   ├── perf.ts                      Laufzeitmessung des Routing-Kerns
│   └── angular/                     Angular-App mit weiteren Plugins, Benchmark in headless Chrome
├── docs/DOKUMENTATION.md            dieses Dokument
├── docs/LIZENZ.md                   lizenzrechtliche Hinweise (LGPL)
├── licenses/                        Lizenztexte (LGPL-2.1, Cytoscape MIT)
├── THIRD-PARTY-NOTICES.md           verwendete Fremdkomponenten
├── scripts/build-demo.ts            bündelt die Demo nach demo/build/
├── scripts/ts-resolve.ts            lässt Node.js die Importe ohne .ts-Endung auflösen (Tests, perf)
├── scripts/serve.ts                 Mini-Webserver für die Demo
├── test/                            Tests (node:test): routing, edge-style, plugin + helpers.ts
├── .github/workflows/               ci.yml (Typprüfung, Format, Tests), pages.yml (Demo)
├── tsconfig.json                    Typprüfung (npm run typecheck) mit üblichen App-Einstellungen
├── LICENSE                          MIT-Lizenz des Plugin-Codes
├── package.json
└── README.md                        Kurzfassung (englisch)
```

## 3. Installation und Einbindung

Das Plugin wird nicht als npm-Paket ausgeliefert, sondern als TypeScript-Quellcode,
den Ihr Projekt selbst mitkompiliert (Angular, Vite, webpack, esbuild …).

1. Ordner `src/` in Ihr Projekt kopieren, z. B. nach
   `src/app/cytoscape-libavoid/`.
2. Abhängigkeiten installieren:

   ```sh
   npm install cytoscape libavoid-js
   ```

3. In der `tsconfig.json` Ihres Projekts muss `skipLibCheck: true` gesetzt sein
   (Standard bei Angular und Vite), weil libavoid-js fehlerhafte `.d.ts`-Dateien
   mitliefert. `moduleResolution` muss `"bundler"` oder `"node"` sein. Die
   Quellen kompilieren auch mit allen Strenge-Optionen (u. a.
   `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) und brauchen
   keine Bibliothek neuer als ES2020 und TypeScript ab 5.0; geprüft mit
   `tsconfig.strict.json`.
4. Registrieren und verwenden:

   ```ts
   import cytoscape from 'cytoscape';
   import cytoscapeLibavoid from './cytoscape-libavoid';

   cytoscape.use(cytoscapeLibavoid);
   ```

5. `libavoid.wasm` als statische Datei ausliefern, siehe
   [Abschnitt 4](#4-die-webassembly-datei).

### Node.js

In Node.js (z. B. Tests mit headless Cytoscape) funktioniert derselbe Import.
Die `.wasm`-Datei wird automatisch aus `node_modules/libavoid-js` geladen.

## 4. Die WebAssembly-Datei

libavoid ist C++-Code, der als `libavoid.wasm` (~480 kB) ausgeliefert wird. Die
Datei wird beim ersten Aufruf von `cy.libavoid()` asynchron geladen, danach im
Speicher gehalten und von allen Cytoscape-Instanzen der Seite gemeinsam
genutzt.

Im Browser kopieren Sie `node_modules/libavoid-js/dist/libavoid.wasm` in die
statischen Assets und geben die URL als `wasmUrl` an. Bei Angular genügt ein
Eintrag unter `assets` in der `angular.json`:

```json
{ "glob": "libavoid.wasm", "input": "node_modules/libavoid-js/dist", "output": "/" }
```

Bei anderen Bundlern kopieren Sie die Datei einmalig (oder per Build-Skript):

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
- In Node.js ist keine `wasmUrl` nötig.

## 5. Schnellstart

```js
import cytoscape from 'cytoscape';
import cytoscapeLibavoid from './cytoscape-libavoid';

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
  ports: 'docking',
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
| `ports` | `'auto' \| 'docking'` | `'auto'` | `auto`: ein gemeinsamer Anschluss pro Knotenseite, libavoid wählt die Seite. `docking`: eigener Docking Port je Kantenende, gestapelt nach Breite (siehe [10.2](#102-docking-ports)). |
| `flowDirection` | `'right' \| 'left' \| 'down' \| 'up'` | `'right'` | Nur bei `docking`: Hauptflussrichtung. Bei `right` verlassen Kanten die Quelle rechts und erreichen das Ziel links. |
| `portSpacing` | `number` (px) | `2` | Nur bei `docking`: Abstand zwischen benachbarten Ports an einer Knotenseite. |
| `shapeBufferDistance` | `number` (px) | `12` | Mindestabstand der Routen zu Knoten. |
| `idealNudgingDistance` | `number \| 'auto'` | `'auto'` | Abstand zwischen parallel laufenden Segmenten. `auto` = Breite der breitesten Kante + `portSpacing`, mindestens 4. |
| `nudgeConnectedSegments` | `boolean \| 'auto'` | `'auto'` | Auch Segmente auseinanderschieben, die direkt an einem Knoten enden. `auto` = an bei `ports: 'auto'`, aus bei `docking` (dort liegen die Ports schon fest). |
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
| `dragRouteInterval` | `number` (ms) `\| 'auto'` | `'auto'` | Nur bei `rerouteOnDrag`: Mindestpause zwischen zwei Läufen während des Ziehens. `auto` = so lange wie der letzte Lauf gedauert hat; das Routing belegt dann höchstens etwa die Hälfte der Zeit und das Ziehen bleibt flüssig. `0` = in jedem Frame routen. Beim Loslassen wird immer die Endposition geroutet. |

### Laden

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `wasmUrl` | `string` | – | URL von `libavoid.wasm`, siehe [Abschnitt 4](#4-die-webassembly-datei). Wirkt nur beim ersten Laden der Seite. |
| `avoidLib` | `object` | – | Bereits geladene libavoid-js-Instanz (`AvoidLib.getInstance()`). Überspringt das Laden. Nicht mit `worker`. |
| `worker` | `Worker` | – | Routet in diesem Web Worker (mit `routing.worker.ts`) statt im Haupt-Thread, siehe [Routing im Web Worker](#routing-im-web-worker). |

## 7. Daten an Knoten und Kanten

| Feld | Element | Werte | Wirkung |
|---|---|---|---|
| `data(sourceSide)` | Kante | `'top' \| 'right' \| 'bottom' \| 'left'` | Nur bei `docking`: Seite, an der die Kante die Quelle verlässt. Überschreibt `flowDirection`. |
| `data(targetSide)` | Kante | wie oben | Nur bei `docking`: Seite, an der die Kante das Ziel erreicht. |

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
| `ready` | `Promise<LibavoidRouting>` | Erfüllt sich, sobald libavoid geladen ist und der erste Routing-Lauf fertig ist. Wird abgelehnt, wenn die `.wasm` nicht geladen werden kann oder der erste Lauf fehlschlägt. |
| `options` | `object` | Aktuelle Optionen (Standardwerte und eigene Werte zusammengeführt). Nur lesen, ändern über `setOptions()`. |
| `routes` | `Map<string, Point[]>` | Ergebnis des letzten Laufs: Kanten-ID → Punkte. |
| `cy` | Core | Die zugehörige Cytoscape-Instanz. |

`Point` ist `{ x: number, y: number }` in Modellkoordinaten. Der erste Punkt
liegt am Rand der Quelle, der letzte am Rand des Ziels.

#### `route()` → `Map<string, Point[]>`

Routet alle passenden Kanten sofort und synchron, setzt die Styles und löst
`avoidrouted` aus. Wirft einen Fehler, wenn `ready` noch nicht erfüllt ist,
und ist mit `worker` nicht verfügbar (dort `refresh()` nehmen).
Bei `live: true` müssen Sie `route()` normalerweise nicht selbst aufrufen.

#### `refresh()` → `Promise<Map<string, Point[]>>`

Wie `route()`, aber asynchron und damit auch mit `worker` nutzbar. Läuft
gerade eine Anfrage im Worker, wartet `refresh()` auf eine neue mit dem
aktuellen Stand. Fehler lehnen das Promise ab.

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
`wasmUrl`, `avoidLib` und `worker` wirken nach dem Erzeugen nicht mehr. Mit
`worker` kommen Fehler als Event `avoiderror`, sonst wirft `setOptions()`.

```js
routing.setOptions({ ports: 'auto', cornerRadius: 0 });
```

#### `model()` → `{ nodes, edges }`

Liefert das Datenmodell, das an den Routing-Kern geht (siehe
[8.5](#85-routing-ohne-cytoscape)). Hilfreich zum Debuggen.

#### `destroy()`

Beendet das Routing: Listener werden entfernt, die gesetzten Style-Bypässe
gelöscht und die Kanten zeigen wieder ihren Stylesheet-Stil. Danach gibt
`cy.libavoid()` eine neue Instanz zurück. Ein `worker` läuft weiter (er gehört
der Anwendung). `cy.destroy()` beendet das Routing automatisch mit.

### 8.4 Weitere Exporte

```ts
import cytoscapeLibavoid, {
  LibavoidRouting, defaults, loadLibavoid,
  EdgeRouter, EdgeStyler, LibavoidRouter,
  computeDockingPorts, spreadPorts, simplify,
  routeToEdgeStyle, edgeStyleToPoints,
} from './cytoscape-libavoid';
```

| Export | Datei | Beschreibung |
|---|---|---|
| `default` | `index.ts` | Registrierungsfunktion für `cytoscape.use()` |
| `LibavoidRouting` | `index.ts` | Klasse hinter `cy.libavoid()`, siehe 8.3 |
| `defaults` | `index.ts` | Standardoptionen (eingefroren) |
| `EdgeRouter` | `routing.ts` | Routet ein Datenmodell ohne Cytoscape, siehe 8.5 |
| `WorkerRouter` | `routing.ts` | Asynchrones Gegenstück zu `EdgeRouter`: schickt Anfragen an einen Worker mit `routing.worker.ts` (`route()`, `busy`, `dispose()`) |
| `computeDockingPorts(model, options)` | `routing.ts` | Berechnet nur die Docking Ports, siehe 8.5 |
| `spreadPorts(widths, sideLength, spacing)` | `routing.ts` | Verteilt Ports gegebener Breite auf einer Seite, liefert die Mitten als Anteil 0–1 |
| `simplify(points)` | `routing.ts` | Rundet Koordinaten auf 3 Nachkommastellen und entfernt doppelte und kollineare Punkte |
| `loadLibavoid(wasmUrl?)` → `Promise<Avoid>` | `libavoid.ts` | Lädt libavoid einmalig und gibt die Instanz zurück. Weitere Aufrufe liefern dasselbe Promise. Nach einem Fehler wird beim nächsten Aufruf neu versucht. |
| `LibavoidRouter` | `libavoid.ts` | Dünne Hülle um die libavoid-API (Formen, Pins, Verbinder) inkl. Speicherfreigabe; Grundlage von `EdgeRouter` |
| `EdgeStyler` | `edge-style.ts` | Setzt Routen als Style-Bypass auf Cytoscape-Kanten (`apply`) und entfernt sie wieder (`clear`) |
| `routeToEdgeStyle(points, sourceCentre, targetCentre, cornerRadius?)` | `edge-style.ts` | Wandelt eine Route in ein Cytoscape-Style-Objekt um, siehe 10.3 |
| `edgeStyleToPoints(style, sourceCentre, targetCentre)` | `edge-style.ts` | Umkehrung von `routeToEdgeStyle` |

Alle Optionen sind an den Typen `LibavoidOptions` und `RoutingOptions`
dokumentiert und erscheinen so auch im Editor.

### 8.5 Routing ohne Cytoscape

`EdgeRouter` kennt Cytoscape nicht. Sie können ihn mit anderen Renderern
(SVG, Canvas, D3) oder serverseitig nutzen.

```ts
import { EdgeRouter, loadLibavoid } from './cytoscape-libavoid';

const avoid = await loadLibavoid();
const router = new EdgeRouter(avoid, { routingType: 'orthogonal' });
const routes = router.route({
  nodes: [
    { id: 'a', x: 0, y: 0, width: 60, height: 40 }, // x/y = Mittelpunkt
    { id: 'b', x: 300, y: 0, width: 60, height: 40 },
    { id: 'wand', x: 150, y: 0, width: 40, height: 200 },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', width: 4 }],
});

routes.get('ab');
// [{x:0,y:-20}, {x:0,y:-112}, {x:300,y:-112}, {x:300,y:-20}]
// oben aus a heraus, über die Wand, oben in b hinein
```

Ein `EdgeRouter` kann beliebig oft `route()` aufrufen; seine Optionen stehen
in `router.options`.

**Modell**

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `nodes[].id` | ja | eindeutige ID |
| `nodes[].x`, `.y` | ja | Mittelpunkt |
| `nodes[].width`, `.height` | ja | Breite, Höhe |
| `edges[].id` | ja | eindeutige ID |
| `edges[].source`, `.target` | ja | Knoten-IDs |
| `edges[].width` | nein | Breite für Stapeln und Nudging (Standard 0) |
| `edges[].sourceSide`, `.targetSide` | nein | erzwungene Seite bei `docking` |

Schleifen (Quelle = Ziel) und Kanten mit unbekannten Endpunkten werden
übersprungen. Optionen wie in [Abschnitt 6](#6-optionen) (nur der Teil
„Routing“).

Für jeden `route()`-Aufruf baut `EdgeRouter` über `LibavoidRouter` einen neuen
libavoid-Router auf und gibt danach den gesamten WebAssembly-Speicher wieder frei.

**`computeDockingPorts(model, { flowDirection, portSpacing })`** gibt
`Map<edgeId, { source: { side, offset }, target: { side, offset } }>` zurück.
`offset` ist die relative Position (0 bis 1) entlang der Knotenseite.

## 9. Events

| Event | Ziel | Extra-Parameter | Wann |
|---|---|---|---|
| `avoidrouted` | `cy` | `{ edges, routingMs, totalMs }` | nach jedem Routing-Lauf |
| `avoiderror` | `cy` | `Error` | wenn ein automatischer Lauf (durch eine Änderung am Graphen ausgelöst) fehlschlägt |

- `edges`: Anzahl gerouteter Kanten
- `routingMs`: Zeit in libavoid
- `totalMs`: inklusive Setzen der Styles

```js
cy.on('avoidrouted', (evt, info) => {
  console.log(`${info.edges} Kanten in ${info.totalMs.toFixed(1)} ms`);
});
cy.on('avoiderror', (evt, error) => showWarning(error.message));
```

Ein fehlgeschlagener automatischer Lauf wird zusätzlich mit `console.error`
protokolliert; das Plugin läuft weiter und versucht es bei der nächsten
Änderung erneut. Fehler bei `route()` und `setOptions()` werden dagegen direkt
an den Aufrufer geworfen.

Bei `live: true` hört das Plugin auf diese Cytoscape-Events:

| Event | Selektor | Grund |
|---|---|---|
| `add`, `remove`, `data` | alle Elemente | Graph oder Daten geändert |
| `class`, `style` | Knoten | Knotengröße kann sich ändern |
| `class` | Kanten | Kantenbreite kann sich ändern |
| `position` | Knoten | Verschieben (beim Ziehen nur bei `rerouteOnDrag`) |
| `free` | Knoten | Ziehen beendet |

Alle Events eines Frames werden zu einem Lauf zusammengefasst. Ein Layout mit
vielen Positionsänderungen löst also nur wenige Läufe aus. Während ein Knoten
gezogen wird, liegen die Läufe mindestens `dragRouteInterval` auseinander.

## 10. Wie das Plugin arbeitet

### 10.1 Ablauf eines Routing-Laufs

1. `model()` sammelt alle sichtbaren Knoten, die zu `obstacles` passen, mit
   ihrer Bounding Box, und alle sichtbaren Kanten aus `edges`, deren beide
   Endpunkte Hindernisse sind.
2. `EdgeRouter.route()` legt über `LibavoidRouter` für jeden Knoten ein
   Rechteck an, erzeugt die Anschlusspunkte (Ports) und verbindet sie, dann
   wird geroutet. Jede Route wird vereinfacht.
3. `EdgeStyler.apply()` rechnet die Routen in Cytoscape-Styles um und setzt sie
   in einem `cy.batch()` als Bypass; unveränderte Kanten werden übersprungen.
4. `avoidrouted` wird ausgelöst.

Bei jedem Lauf wird der komplette Graph neu geroutet. Ein Lauf ist meist so
schnell, dass das auch beim Ziehen flüssig bleibt (siehe
[Performance](#12-performance)).

### 10.2 Docking Ports

Im Modus `docking` gilt für jede Knotenseite:

1. Alle Kanten, die diese Seite nutzen, werden nach der Lage des Gegenknotens
   entlang der Seite sortiert: an linken und rechten Seiten nach dessen
   y-Koordinate, an oberen und unteren nach dessen x-Koordinate. Das gilt
   auch für Seiten, die per `sourceSide` / `targetSide` erzwungen werden.
2. Die Kanten werden in dieser Reihenfolge lückenlos gestapelt. Jede belegt
   ihre Breite, dazwischen liegt `portSpacing`. Der Stapel sitzt mittig auf der
   Seite.
3. Ist der Stapel länger als die Seite, wird er proportional gestaucht.
4. Jede Kante bekommt einen exklusiven Docking Port in der Mitte ihres Bandes.

So setzen die Kanten nebeneinander ohne Lücke am Knoten an und kreuzen sich
nicht direkt am Knoten. Die Verteilung auf einer Seite übernimmt
`spreadPorts()`.

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
cy.libavoid({ ports: 'docking', edgeWidth: (e) => e.data('menge') * 0.5 });
```

### Weniger Kreuzungen, weniger Knicke

```js
cy.libavoid({ routingParameters: { crossingPenalty: 200, segmentPenalty: 50 } });
```

### React

```jsx
import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import cytoscapeLibavoid from './cytoscape-libavoid';

cytoscape.use(cytoscapeLibavoid);

export function Flussdiagramm({ elements }) {
  const ref = useRef(null);
  useEffect(() => {
    const cy = cytoscape({ container: ref.current, elements, layout: { name: 'preset' } });
    const routing = cy.libavoid({ ports: 'docking', wasmUrl: '/libavoid.wasm' });
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

### Routing im Web Worker

Bei großen Graphen dauert ein Lauf 100 ms bis 1 s (siehe
[Performance](#12-performance)) und blockiert so lange die Seite. Mit einem
Worker baut der Haupt-Thread nur das Modell und setzt die Styles; libavoid
läuft im Worker.

```ts
const worker = new Worker(new URL('./cytoscape-libavoid/routing.worker', import.meta.url), { type: 'module' });
const routing = cy.libavoid({ worker, wasmUrl: 'libavoid.wasm' });
await routing.ready;
```

- Angular, Vite und webpack 5 erkennen das Muster `new Worker(new URL(...), …)`
  und bündeln `routing.worker.ts` als eigene Datei. Bei esbuild ohne dieses
  Feature den Worker als eigenen Einstiegspunkt bauen (so macht es
  `scripts/build-demo.ts`).
- `wasmUrl` wird vor dem Senden gegen die Seiten-URL aufgelöst, denn der
  Worker würde relative URLs gegen sein eigenes Skript auflösen.
- Es ist immer nur eine Anfrage unterwegs. Änderungen in der Zwischenzeit
  werden gesendet, sobald die Antwort da ist; bei schnellen Änderungen wird so
  immer der neueste Stand geroutet.
- `route()` ist synchron und daher mit Worker nicht verfügbar, `refresh()`
  funktioniert in beiden Fällen.
- `dragRouteInterval: 'auto'` legt mit Worker keine Pause ein, weil der
  Haupt-Thread nicht blockiert.
- Mehrere Instanzen dürfen sich einen Worker teilen. Das Plugin beendet ihn
  nicht; bei Bedarf `worker.terminate()` selbst aufrufen.

Im Angular-Benchmark (Graph M, Docking Ports) läuft das Ziehen mit Worker mit
168 fps statt 107 fps ohne, ohne lange Tasks im Haupt-Thread; Knoten
hinzufügen und entfernen kostet 48 ms statt 260 ms Skriptzeit. Die Demo nutzt
den Worker mit `?worker=1`.

## 12. Performance

Ein Lauf routet immer den kompletten Graphen neu. Gemessen mit `npm run perf`
(Node.js 25, nur `EdgeRouter`, ohne Cytoscape) auf den Materialfluss-Graphen
des Angular-Benchmarks:

| Graph | `ports: 'auto'` | `ports: 'docking'` | `routingType: 'polyline'` |
|---|--:|--:|--:|
| S: 45 Knoten, 53 Kanten | ~6 ms | ~5 ms | ~85 ms |
| M: 128 Knoten, 182 Kanten | ~49 ms | ~71 ms | ~2100 ms |
| L: 300 Knoten, 488 Kanten | ~470 ms | ~1030 ms | – |

Im Browser liegen die Zeiten in derselben Größenordnung. Fast die gesamte Zeit
verbringt libavoid selbst (Sichtbarkeitsgraph und Nudging). Ein über mehrere
Läufe erhaltener Router bringt kaum etwas: Schon das Verschieben eines
einzelnen Knotens kostet so viel wie ein kompletter Lauf, weil libavoid das
Nudging für den ganzen Graphen neu rechnet.

**Ziehen:** Mit `dragRouteInterval: 'auto'` (Standard) wartet das Plugin
während des Ziehens nach jedem Lauf so lange, wie der Lauf gedauert hat. Im
Angular-Benchmark (Graph M, Knoten 1,5 s lang ziehen) steigt die Bildrate
dadurch von 22 auf 105 fps, die Skriptzeit sinkt von 7,2 s auf 1,3 s. Die
Kanten folgen dann etwa fünfmal pro Sekunde, beim Loslassen wird die
Endposition geroutet.

Die libavoid-Option `performUnifyingNudgingPreprocessingStep` ist
standardmäßig ausgeschaltet. Eingeschaltet steigt die Zeit für einen Graphen
mit 64 Knoten und 112 Kanten von ~50 ms auf 3,4 s (`auto`) bzw. von ~140 ms
auf 16 s (`docking`), dafür gibt es etwas weniger Knicke. Bei kleinen Graphen
ohne Live-Ziehen können Sie sie wieder einschalten:

```js
cy.libavoid({ routingOptions: { performUnifyingNudgingPreprocessingStep: true } });
```

Weitere Hebel bei großen Graphen:

- bei `orthogonal` bleiben: `polyline` ist um ein Vielfaches langsamer (siehe Tabelle)
- `ports: 'auto'` ist bei großen Graphen etwa doppelt so schnell wie `docking`
- `rerouteOnDrag: false`: nur beim Loslassen neu routen
- über `edges` und `obstacles` nur den nötigen Teil des Graphen routen
- `live: false` und `routing.route()` gezielt aufrufen, wenn sich viele Daten
  ändern, die Geometrie aber selten

## 13. Fehlersuche

| Problem | Ursache und Lösung |
|---|---|
| `ready` wird abgelehnt, 404 auf `libavoid.wasm` | Datei wird nicht ausgeliefert oder `wasmUrl` stimmt nicht. Den Pfad im Netzwerk-Tab der Browser-Entwicklertools prüfen. |
| Fehler beim Laden von der Festplatte | Seite wurde über `file://` geöffnet. Über einen Webserver ausliefern (z. B. `npm run demo`). |
| `CompileError` oder CSP-Meldung zu WebAssembly | `'wasm-unsafe-eval'` in `script-src` der Content-Security-Policy ergänzen. |
| `not ready yet, await routing.ready first` | `route()` wurde vor dem Laden aufgerufen. Erst `await routing.ready`. |
| Alle Knoten liegen auf (0, 0), Kanten haben keine Route | Ohne `layout` setzt Cytoscape den `null`-Layout ein, der alle Knoten auf (0, 0) legt. `layout: { name: 'preset' }` oder ein echtes Layout angeben. |
| Eine Kante wird nicht geroutet | Ein Endpunkt passt nicht zu `obstacles` (z. B. ein Compound-Knoten bei `node:childless`), ein Element ist unsichtbar, oder es ist eine Schleife. Mit `routing.model()` prüfen, was ankommt. |
| Kanten laufen durch Beschriftungen | `includeLabels: true` |
| Kanten liegen zu dicht am Knoten | `shapeBufferDistance` erhöhen |
| Kanten an einer Knotenseite überlappen | Knotenseite zu kurz, die Bänder werden gestaucht. Knoten größer machen oder `edgeWidth` verkleinern. |
| Unbekannter Parameter- oder Optionsname | Schreibweise mit den Listen in [Abschnitt 6](#6-optionen) vergleichen. Bei automatischen Läufen kommt der Fehler über das Event `avoiderror` und die Konsole. |
| Kanten hängen beim Ziehen hinterher | Gewollt bei großen Graphen, siehe `dragRouteInterval` in [Abschnitt 12](#12-performance). `dragRouteInterval: 0` routet in jedem Frame. |
| Node-Prozess (Tests) beendet sich nicht | Am Ende `cy.destroy()` aufrufen. |

## 14. Demo

`demo/index.html` zeigt einen Materialfluss mit 9 Stationen, einem reinen
Hindernis (QS) und 13 Flüssen. Die Kantenbreite entspricht der Menge in
t/Tag.

**Starten** (Node.js ≥ 22.18):

```sh
npm install
npm run demo                    # bündelt demo/main.ts, startet den Server
# → http://localhost:8080/demo/
# anderer Port: PORT=3000 npm run demo  (PowerShell: $env:PORT=3000; npm run demo)
```

Die Demo braucht einen Webserver, weil der Browser `.wasm` nicht von
`file://` lädt. Jeder andere statische Server geht genauso
(`npx serve`, `python -m http.server`), wenn er nach `npm run build:demo` im
Repo-Ordner gestartet wird.

**Bedienung**

| Element | Wirkung |
|---|---|
| Ports | `docking` / `auto` |
| Routing | `orthogonal` / `polyline` |
| Fluss | `flowDirection` |
| Eckradius | `cornerRadius` 0–20 px |
| beim Ziehen routen | `rerouteOnDrag` |
| + Hindernis | fügt einen Knoten an zufälliger Stelle ein, die Kanten weichen sofort aus |
| Knoten ziehen | Live-Routing |

Unten rechts zeigt die Demo die Werte aus dem Event `avoidrouted`.

Der Code der Demo (`demo/main.ts`) importiert `src`
genau so, wie es ein anderes Projekt tut, und eignet sich als Vorlage.

## 15. Entwicklung

```sh
npm install
npm test            # Tests (node:test), inkl. Integrationstest mit headless Cytoscape
npm run typecheck   # Typprüfung mit tsc (Plugin, Tests, Skripte, Demo)
npm run perf        # Laufzeit des Routing-Kerns
npm run demo        # Demo bündeln + Demo-Server auf http://localhost:8080/demo/
```

Das Plugin importiert seine Dateien ohne `.ts`-Endung, wie es Bundler
erwarten. Node.js führt Tests und Benchmark direkt per Type Stripping aus;
`scripts/ts-resolve.ts` ergänzt dabei die Endung.

Aufbau des Quellcodes (eine Klasse pro Datei):

| Datei | Klasse | Aufgabe |
|---|---|---|
| `index.ts` | `LibavoidRouting` | Plugin-Wrapper: Optionen, Modell aus `cy` erzeugen, auf Änderungen hören, Registrierung von `cy.libavoid()`. Delegiert Routing und Styling. |
| `routing.ts` | `EdgeRouter` | Routing-Logik und Docking Ports. Kennt nur das einfache Modell, nicht Cytoscape. |
| `libavoid.ts` | `LibavoidRouter` | libavoid-Anbindung: lädt die `.wasm`, kapselt die libavoid-API und deren Speicherverwaltung. |
| `edge-style.ts` | `EdgeStyler` | Route ↔ Cytoscape-Style (reine Geometrie) und das Setzen / Entfernen der Styles. |
| `routing.worker.ts` | – | Einstieg des Web Workers: beantwortet `RouteRequest`s mit `answerRouteRequest()` aus `routing.ts`. |

Wichtig beim Arbeiten mit libavoid-js: Jedes mit `new` erzeugte Objekt liegt im
WebAssembly-Speicher und muss mit `.delete()` freigegeben werden. Dasselbe gilt
für Objekte, die Methoden zurückgeben: libavoid-js nutzt embind, das Kopien
herausgibt, z. B. `displayRoute()` (eine `PolyLine`) und `at(i)` (ein `Point`).

All das übernimmt `LibavoidRouter`: Hilfsobjekte merkt er sich und gibt sie in
`dispose()` frei, zurückgegebene Kopien gibt er sofort nach dem Auslesen frei,
und Objekte, die dem libavoid-Router gehören (Shapes, Pins, Connectors), werden
mit dem Router freigegeben. `EdgeRouter.route()` ruft `dispose()` im
`finally`-Block auf. Der Test `test/memory.test.ts` prüft, dass alle
zurückgegebenen Kopien freigegeben werden.

Formatiert wird mit Prettier (`npm run format`, Prüfung: `npm run format:check`).

## 16. Lizenz

Der Plugin-Code steht unter der **MIT-Lizenz** (`LICENSE`).

libavoid und libavoid-js stehen unter **LGPL-2.1-or-later**. Eine Anwendung,
die das Plugin nutzt, bündelt libavoid-js. Wer sie weitergibt,
wozu auch eine öffentliche Webanwendung zählt, muss die LGPL-Pflichten
erfüllen. Was das konkret bedeutet, was im Paket schon erledigt ist und was
noch offen ist, steht in **[LIZENZ.md](LIZENZ.md)**.
