# cytoscape-libavoid – Entwicklerdokumentation

Version 0.1.0 · für Cytoscape.js ≥ 3.2 · libavoid-js 0.5.0-beta.5

`cytoscape-libavoid` ist eine Cytoscape.js-Erweiterung, die Kanten mit
[libavoid](https://www.adaptagrams.org/documentation/libavoid.html) routet,
einer C++-Bibliothek für hindernisvermeidendes Kantenrouting. Sie läuft als
WebAssembly im Browser und in Node.js. Typischer Einsatz sind Materialfluss-
und Prozessdiagramme: Pfeile im Taxi-Stil, die um Knoten herumführen.

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

- **Orthogonales Routing** (nur waagerechte und senkrechte Segmente). Knoten
  werden als Hindernisse umfahren.
- **Anschlusspunkte:** Jeder Knoten hat einen Anschlusspunkt in der Mitte
  jeder Seite, libavoid wählt die günstigste Seite und schiebt die Kantenenden
  daran auseinander (siehe [10.2](#102-anschlusspunkte)).
- **Nudging:** Parallel laufende Segmente werden auseinandergeschoben, der
  Abstand richtet sich automatisch nach der breitesten Kante.
- **Keine übereinanderliegenden Kanten:** Wo libavoid viele Kanten in eine
  schmale Lücke zwischen Knoten legt, werden sie nach ihrer Breite
  auseinandergeschoben, und Kanten, die nicht hineinpassen, laufen durch die
  nächste breitere Lücke (siehe [10.4](#104-überlappungen-auflösen)).
- **Beschriftung auf dem längsten Segment** statt auf einer Ecke, optional.
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
│   ├── index.ts                     öffentliche API: Registrierung von cy.libavoid(), Exporte für Anwendungen
│   ├── routing.worker.ts            Einstieg für das optionale Routing im Web Worker
│   ├── shared/                      Basis für alle Ordner: Geometrie, Datenmodell, Meldungen und Prüfung der Optionen
│   ├── cytoscape-adapter/           einziger Ordner, der Cytoscape kennt: Klasse LibavoidRouting, Optionen, Route ↔ Style, Klasse EdgeStyler
│   ├── routing/                     Routing-Logik: Klasse EdgeRouter, Schnittstelle RoutingBackend, Klasse LocalRouter
│   ├── postprocess/                 Nachbearbeitung auf einer RouteGeometry: simplify, Auseinanderschieben, Umwege, Qualität
│   ├── libavoid/                    libavoid-Anbindung: loadLibavoid, Klasse LibavoidSession, Typen
│   ├── worker/                      Web Worker: Nachrichten, Klasse WorkerRouter
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
├── test/                            Tests (node:test): routing, route-style, plugin + helpers.ts
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
        width: 'data(menge)',            // Breite = Menge, bestimmt den Abstand paralleler Kanten
        'line-color': '#d9822b',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#d9822b',
        'curve-style': 'taxi',           // Anzeige, bis die erste Route fertig ist
      },
    },
  ],
});

const routing = cy.libavoid({
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
| `edgeSpacing` | `number` (px) | `2` | Abstand zwischen benachbarten parallelen Kanten. |
| `shapeBufferDistance` | `number` (px) | `12` | Mindestabstand der Routen zu Knoten. |
| `idealNudgingDistance` | `number \| 'auto'` | `'auto'` | Abstand zwischen parallel laufenden Segmenten. `auto` = Breite der breitesten Kante + `edgeSpacing`, mindestens 4. |
| `nudgeConnectedSegments` | `boolean` | `true` | Auch Segmente auseinanderschieben, die direkt an einem Knoten enden, damit sich Kanten am gemeinsamen Anschlusspunkt nicht überdecken. |
| `separateOverlaps` | `boolean` | `true` | Segmente, die libavoid übereinanderlegt, nach ihrer Breite auseinanderschieben, siehe [10.4](#104-überlappungen-auflösen). |
| `detourCrowded` | `boolean` | `true` | Kanten, die nicht in eine schmale Lücke passen, durch eine breitere führen (zweiter libavoid-Lauf, etwa doppelte Zeit), siehe [10.4](#104-überlappungen-auflösen). |
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
| `obstacles` | Selektor | `'node:childless'` | Welche Knoten Hindernisse sind. Compound-Eltern zählen standardmäßig nicht dazu. Kanten zu anderen sichtbaren Knoten (z. B. Compound-Knoten) werden trotzdem geroutet: Sie enden in der Mitte der Seite, die zum anderen Ende zeigt, und andere Kanten dürfen diese Knoten kreuzen. Kanten zwischen einem Compound-Knoten und einem Knoten darin werden nicht geroutet. |
| `includeLabels` | `boolean` | `false` | Knotenbeschriftungen gehören mit zum Hindernis. |
| `edgeWidth` | `(edge) => number` | `e => e.numericStyle('width')` | Liefert die Breite einer Kante für Nudging und Auseinanderschieben. Nützlich, wenn die angezeigte Breite nicht der Fluss-Breite entsprechen soll. |
| `edgeSides` | `(edge) => { source?, target? }` | – | Erlaubte Seiten je Kantenende: eine Seite (`'top'`, `'right'`, `'bottom'`, `'left'`) oder eine Liste. Fehlt eine Angabe, wählt libavoid unter allen vier. Beispiel Fluss von links nach rechts: `e => ({ source: 'right', target: 'left' })`. |
| `cornerRadius` | `number` (px) | `0` | `0` = spitze Ecken (`curve-style: segments`), `> 0` = abgerundete Ecken (`round-segments`). |
| `labelPosition` | `'middle' \| 'longest-segment'` | `'middle'` | `middle`: wo Cytoscape die Beschriftung hinsetzt, bei einer ungeraden Zahl von Knicken auf eine Ecke. `longest-segment`: Mitte des längsten Segments (eines waagerechten, wenn es mindestens halb so lang ist); ersetzt `text-margin-x/y` der Kanten. |

### Verhalten

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `live` | `boolean` | `true` | Bei Änderungen am Graphen automatisch neu routen. Bei `false` routen Sie selbst mit `routing.refresh()`. |
| `rerouteOnDrag` | `boolean` | `true` | Nur bei `live`: auch während des Ziehens routen. Bei `false` erst beim Loslassen. |
| `dragRouteInterval` | `number` (ms) `\| 'auto'` | `'auto'` | Nur bei `rerouteOnDrag`: Mindestpause zwischen zwei Läufen während des Ziehens. `auto` = so lange wie der letzte Lauf gedauert hat; das Routing belegt dann höchstens etwa die Hälfte der Zeit und das Ziehen bleibt flüssig. `0` = in jedem Frame routen. Beim Loslassen wird immer die Endposition geroutet. |
| `dragRouteDelay` | `number` (ms) | `0` | Nur bei `rerouteOnDrag`: erst routen, wenn die gezogenen Knoten so lange ruhen, statt während der Bewegung. `0` = aus. Beim Loslassen wird sofort geroutet. |
| `hideEdgesOnDrag` | `boolean` | `false` | Kanten gezogener Knoten ab der ersten Bewegung ausblenden (`line-opacity` und `text-opacity` 0), bis eine Route für die neue Position anliegt, statt veraltete Routen zu zeigen. Passt zu `dragRouteDelay` oder `rerouteOnDrag: false`. Eigene Bypässe dieser beiden Eigenschaften kommen beim Einblenden zurück; welche, die während des Ausblendens gesetzt werden, gehen verloren. |

### Laden

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `wasmUrl` | `string` | – | URL von `libavoid.wasm`, siehe [Abschnitt 4](#4-die-webassembly-datei). Wirkt nur beim ersten Laden der Seite. |
| `avoidLib` | `object` | – | Bereits geladene libavoid-js-Instanz (`AvoidLib.getInstance()`). Überspringt das Laden. Nicht mit `worker`. |
| `worker` | `Worker` | – | Routet in diesem Web Worker (mit `routing.worker.ts`) statt im Haupt-Thread, siehe [Routing im Web Worker](#routing-im-web-worker). |

## 7. Daten an Knoten und Kanten

Das Plugin liest keine eigenen Datenfelder, nur Geometrie (Bounding Box,
Position), die Kantenbreite (über `edgeWidth`) und die erlaubten Seiten (über
`edgeSides`). Ohne `edgeSides` wählt libavoid die Seite, an der eine Kante einen
Knoten verlässt oder erreicht. Datenfelder lassen sich über diese Funktionen
anbinden, z. B. `edgeSides: (e) => ({ source: e.data('ausgang') })`.

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
| `options` | `object` | Aktuelle Optionen (Standardwerte und eigene Werte zusammengeführt), eingefroren. Ändern über `setOptions()`. |
| `routes` | `Map<string, Point[]>` | Ergebnis des letzten Laufs: Kanten-ID → Punkte. |
| `cy` | Core | Die zugehörige Cytoscape-Instanz. |

`Point` ist `{ x: number, y: number }` in Modellkoordinaten. Der erste Punkt
liegt am Rand der Quelle, der letzte am Rand des Ziels.

#### `refresh()` → `Promise<Map<string, Point[]>>`

Routet alle passenden Kanten, setzt die Styles und löst `avoidrouted` aus, im
Haupt-Thread oder im Worker. Läuft gerade ein Lauf, wartet `refresh()` auf
einen neuen mit dem aktuellen Stand. Fehler lehnen das Promise ab. Bei
`live: true` müssen Sie `refresh()` normalerweise nicht selbst aufrufen.

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

Führt die übergebenen Optionen mit den aktuellen zusammen, prüft sie und
routet neu. Ungültige Optionen (z. B. ein negativer Abstand oder ein
unbekannter libavoid-Parameter) wirft `setOptions()` sofort; Fehler beim
Routen kommen als Event `avoiderror`. Ein Wechsel von `live` bindet die
Event-Listener an oder löst sie. `wasmUrl`, `avoidLib` und `worker` wirken nach
dem Erzeugen nicht mehr.

```js
routing.setOptions({ shapeBufferDistance: 8, cornerRadius: 0 });
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
  LibavoidRouting, defaults,
  loadLibavoid, EdgeRouter, defaultRoutingOptions, routeQuality,
  WorkerRouter,
} from './cytoscape-libavoid';
```

| Export | Datei | Beschreibung |
|---|---|---|
| `default` | `index.ts` | Registrierungsfunktion für `cytoscape.use()` |
| `LibavoidRouting` | `cytoscape-adapter/libavoid-routing.ts` | Klasse hinter `cy.libavoid()`, siehe 8.3 |
| `defaults` | `cytoscape-adapter/options.ts` | Standardoptionen (eingefroren) |
| `loadLibavoid(wasmUrl?)` → `Promise<Avoid>` | `libavoid/load.ts` | Lädt libavoid einmalig und gibt die Instanz zurück. Weitere Aufrufe liefern dasselbe Promise (mit einer anderen URL und einer Warnung). Nach einem Fehler wird beim nächsten Aufruf neu versucht. |
| `EdgeRouter` | `routing/edge-router.ts` | Routet ein Datenmodell ohne Cytoscape, siehe 8.5 |
| `defaultRoutingOptions` | `routing/options.ts` | Standardwerte der Routing-Optionen (eingefroren) |
| `routeQuality(routes, model)` | `postprocess/route-quality.ts` | `{ overlap, crossings, length }` einer Routenmenge, zum Vergleichen |
| `WorkerRouter` | `worker/worker-router.ts` | Asynchrones Gegenstück zu `EdgeRouter` in einem Worker mit `routing.worker.ts`: `new WorkerRouter(worker, wasmUrl)`, `route(model, options)`, `busy`, `dispose()` |

Dazu die Typen `LibavoidOptions`, `EdgeSides`, `RoutedEventInfo`,
`RoutingOptions`, `GraphModel`, `GraphNode`, `GraphEdge`, `Point`, `Side`,
`RouteQuality`, `RoutingWorker` sowie `RoutingBackend` und `RouteResult`, die
gemeinsame Schnittstelle von `WorkerRouter` und dem Routing im Haupt-Thread.
Weitere Bausteine (z. B. `EdgeStyler`, `routeToEdgeStyle`, `separateOverlaps`,
`LibavoidSession`) gehören nicht zur öffentlichen API; wer sie braucht,
importiert sie aus ihrer Datei.

Alle Optionen sind an den Typen `LibavoidOptions` und `RoutingOptions`
dokumentiert und erscheinen so auch im Editor.

### 8.5 Routing ohne Cytoscape

`EdgeRouter` kennt Cytoscape nicht. Sie können ihn mit anderen Renderern
(SVG, Canvas, D3) oder serverseitig nutzen.

```ts
import { EdgeRouter, loadLibavoid } from './cytoscape-libavoid';

const avoid = await loadLibavoid();
const router = new EdgeRouter(avoid, { shapeBufferDistance: 12 });
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
| `nodes[].obstacle` | nein | `false`: nur Endpunkt, kein Hindernis (z. B. ein Compound-Knoten); seine Kanten enden mittig an der Seite zum anderen Ende |
| `edges[].width` | nein | Breite für Nudging und Auseinanderschieben (Standard 0) |
| `edges[].sourceSides`, `.targetSides` | nein | erlaubte Seiten (`'top'`, `'right'`, `'bottom'`, `'left'`); fehlt die Angabe, alle vier |

Schleifen (Quelle = Ziel) und Kanten mit unbekannten Endpunkten werden
übersprungen. Optionen wie in [Abschnitt 6](#6-optionen) (nur der Teil
„Routing“).

Für jeden `route()`-Aufruf baut `EdgeRouter` über eine `LibavoidSession` einen neuen
libavoid-Router auf und gibt danach den gesamten WebAssembly-Speicher wieder frei.
Ungültige Optionen wirft schon `new EdgeRouter()`; `router.options` ist eingefroren.

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
Änderung erneut. Fehler bei `refresh()` lehnen dagegen dessen Promise ab, und
ungültige Optionen wirft `setOptions()` direkt.

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
2. `EdgeRouter.route()` legt über eine `LibavoidSession` für jeden Knoten ein
   Rechteck mit vier Anschlusspunkten an und verbindet sie, dann
   wird geroutet. Jede Route wird vereinfacht. Danach folgen die Umwege für
   überfüllte Lücken und das Auseinanderschieben (siehe 10.4).
3. `EdgeStyler.apply()` rechnet die Routen in Cytoscape-Styles um und setzt sie
   in einem `cy.batch()` als Bypass; unveränderte Kanten werden übersprungen.
4. `avoidrouted` wird ausgelöst.

Bei jedem Lauf wird der komplette Graph neu geroutet. Ein Lauf ist meist so
schnell, dass das auch beim Ziehen flüssig bleibt (siehe
[Performance](#12-performance)).

### 10.2 Anschlusspunkte

Jeder Knoten bekommt vier Anschlusspunkte, je einen in der Mitte jeder Seite;
alle Kanten teilen sie sich. libavoid wählt für jedes Kantenende die
günstigste Seite. `nudgeConnectedSegments` (Standard an) schiebt die Enden, die
an derselben Seite ansetzen, nach ihrer Breite auseinander, damit sie sich am
Knoten nicht überdecken. Wo libavoid sie trotzdem auf einer Linie lässt (etwa
bei vielen Kanten in einen Knoten), fächert `separateOverlaps` sie entlang der
Seite auf (siehe 10.4).

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

### 10.4 Überlappungen auflösen

libavoid hält um jeden Knoten einen Abstand frei (`shapeBufferDistance`) und
schiebt Kanten nicht in diesen Bereich. Wo viele Kanten durch eine schmale
Lücke zwischen Knoten laufen, etwa zwischen den Spalten einer Gruppe, legt es
sie deshalb auf dieselbe Linie. Bei Gruppen mit fluchtenden Spalten bilden
diese Lücken durchgehende „Gassen“, durch die 20–30 Kanten laufen, obwohl nur
etwa drei hineinpassen. Keine libavoid-Option ändert das. Zwei Schritte nach
dem libavoid-Lauf lösen es:

1. **Umwege (`detourCrowded`):** In Gassen, die mehr Kanten nutzen, als
   hineinpassen, bleiben die kurzen, lokalen Abschnitte. Die Kanten, die nur
   durchlaufen, bekommen – die längsten zuerst, höchstens 30 % aller Kanten –
   einen Checkpoint in der nächsten Gasse, die über die ganze Strecke frei und
   deutlich breiter ist. Ein zweiter
   libavoid-Lauf routet durch diese Punkte; das Ergebnis wird nur übernommen,
   wenn es deutlich weniger überlappt, ohne viel länger zu werden oder viel
   öfter zu kreuzen.
2. **Auseinanderschieben (`separateOverlaps`):** Übrige übereinanderliegende
   Segmente werden um ihre Breite plus `edgeSpacing` auseinandergeschoben,
   innerhalb der Lücke (notfalls in einen Teil des Abstands zum Knoten), nie in
   einen Knoten hinein. Das erste und letzte Segment einer Route gleitet nur
   entlang der Knotenseite, an der es endet; Kanten am selben Anschlusspunkt
   fächern so entlang der Seite auf. Ist die Seite zu kurz für alle Kanten,
   werden sie gestaucht. Wird ein senkrechtes Segment verschoben,
   strecken sich nur seine waagerechten Nachbarn; die Route bleibt orthogonal.

Gemessen mit `npm run quality` auf dem Graphen M (128 Knoten, 182 Kanten):

| | übereinanderliegende Striche | Kreuzungen | Länge |
|---|--:|--:|--:|
| nur libavoid | 61.940 px | 1310 | 140.154 |
| jetzt | **6.175 px** | 1348 | 146.516 |

Keine Kante läuft durch einen Knoten. Die Umwege kosten einen zweiten
libavoid-Lauf; während des Ziehens wird deshalb ohne sie geroutet (Entwurf),
beim Loslassen einmal vollständig.

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
await routing.refresh();
```

### Nach einem Layout

Bei `live: true` passiert das automatisch, die Positionsänderungen werden pro
Frame zusammengefasst. Bei `live: false`:

```js
cy.layout({ name: 'dagre' }).run();
cy.one('layoutstop', () => routing.refresh());
```

### Flussbreite unabhängig von der angezeigten Breite

```js
cy.libavoid({ edgeWidth: (e) => e.data('menge') * 0.5 });
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
    const routing = cy.libavoid({ wasmUrl: '/libavoid.wasm' });
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
- `dragRouteInterval: 'auto'` legt mit Worker keine Pause ein, weil der
  Haupt-Thread nicht blockiert.
- Mehrere Instanzen dürfen sich einen Worker teilen. Das Plugin beendet ihn
  nicht; bei Bedarf `worker.terminate()` selbst aufrufen.

Im Angular-Benchmark (Graph M) läuft das Ziehen mit Worker mit
175 fps statt 87 fps ohne, ohne lange Tasks im Haupt-Thread; Knoten
hinzufügen und entfernen kostet 48 ms statt 650 ms Skriptzeit. Die Demo nutzt
den Worker mit `?worker=1`.

## 12. Performance

Ein Lauf routet immer den kompletten Graphen neu. Gemessen mit `npm run perf`
(Node.js 25, nur `EdgeRouter`, ohne Cytoscape) auf den Materialfluss-Graphen
des Angular-Benchmarks:

| Graph | nur libavoid | Standard (mit Umwegen) |
|---|--:|--:|
| S: 45 Knoten, 53 Kanten | ~6 ms | ~12 ms |
| M: 128 Knoten, 182 Kanten | ~49 ms | ~130 ms |
| L: 300 Knoten, 488 Kanten | ~480 ms | ~1230 ms |

Die Umwege (`detourCrowded`) brauchen einen zweiten libavoid-Lauf und
verdoppeln damit etwa die Zeit; `separateOverlaps` kostet ~10 %. Bei großen
Graphen ist der Worker (siehe [Routing im Web Worker](#routing-im-web-worker))
der richtige Weg, dann bleibt alles außerhalb des Haupt-Threads;
`detourCrowded: false` spart den zweiten Lauf.

Im Browser liegen die Zeiten in derselben Größenordnung. Fast die gesamte Zeit
verbringt libavoid selbst (Sichtbarkeitsgraph und Nudging). Ein über mehrere
Läufe erhaltener Router bringt kaum etwas: Schon das Verschieben eines
einzelnen Knotens kostet so viel wie ein kompletter Lauf, weil libavoid das
Nudging für den ganzen Graphen neu rechnet.

**Ziehen:** Mit `dragRouteInterval: 'auto'` (Standard) wartet das Plugin
während des Ziehens nach jedem Lauf so lange, wie der Lauf gedauert hat. Im
Angular-Benchmark (Graph M, Knoten ziehen) steigt die Bildrate dadurch von
16 auf 87 fps, die Skriptzeit sinkt von 9,9 s auf 1,5 s. Die Kanten folgen dann
etwa fünfmal pro Sekunde; während des Ziehens wird ohne Umwege geroutet
(Entwurf), beim Loslassen wird die Endposition vollständig geroutet.

Die libavoid-Option `performUnifyingNudgingPreprocessingStep` ist
standardmäßig ausgeschaltet. Eingeschaltet steigt die Zeit für einen Graphen
mit 64 Knoten und 112 Kanten von ~50 ms auf 3,4 s, dafür gibt es etwas
weniger Knicke. Bei kleinen Graphen
ohne Live-Ziehen können Sie sie wieder einschalten:

```js
cy.libavoid({ routingOptions: { performUnifyingNudgingPreprocessingStep: true } });
```

Weitere Hebel bei großen Graphen:

- `rerouteOnDrag: false`: nur beim Loslassen neu routen
- `dragRouteDelay: 150`: erst routen, wenn der Knoten kurz ruht; mit
  `hideEdgesOnDrag: true` sind die Kanten bis dahin ausgeblendet
- über `edges` und `obstacles` nur den nötigen Teil des Graphen routen
- `live: false` und `routing.refresh()` gezielt aufrufen, wenn sich viele Daten
  ändern, die Geometrie aber selten

## 13. Fehlersuche

| Problem | Ursache und Lösung |
|---|---|
| `ready` wird abgelehnt, 404 auf `libavoid.wasm` | Datei wird nicht ausgeliefert oder `wasmUrl` stimmt nicht. Den Pfad im Netzwerk-Tab der Browser-Entwicklertools prüfen. |
| Fehler beim Laden von der Festplatte | Seite wurde über `file://` geöffnet. Über einen Webserver ausliefern (z. B. `npm run demo`). |
| `CompileError` oder CSP-Meldung zu WebAssembly | `'wasm-unsafe-eval'` in `script-src` der Content-Security-Policy ergänzen. |
| Alle Knoten liegen auf (0, 0), Kanten haben keine Route | Ohne `layout` setzt Cytoscape den `null`-Layout ein, der alle Knoten auf (0, 0) legt. `layout: { name: 'preset' }` oder ein echtes Layout angeben. |
| Eine Kante wird nicht geroutet | Sie verbindet einen Compound-Knoten mit einem Knoten darin, ein Element ist unsichtbar, oder es ist eine Schleife. Mit `routing.model()` prüfen, was ankommt. |
| Kanten laufen durch Beschriftungen | `includeLabels: true` |
| Kanten liegen zu dicht am Knoten | `shapeBufferDistance` erhöhen |
| Kanten an einer Knotenseite überlappen | `nudgeConnectedSegments` ist aus, oder die Seite ist zu kurz für alle Kanten. Einschalten, Knoten größer machen oder `edgeWidth` verkleinern. |
| Unbekannter Parameter- oder Optionsname | Schreibweise mit den Listen in [Abschnitt 6](#6-optionen) vergleichen. Bei automatischen Läufen kommt der Fehler über das Event `avoiderror` und die Konsole. |
| Kanten hängen beim Ziehen hinterher | Gewollt bei großen Graphen, siehe `dragRouteInterval` in [Abschnitt 12](#12-performance). `dragRouteInterval: 0` routet in jedem Frame. |
| Node-Prozess (Tests) beendet sich nicht | Am Ende `cy.destroy()` aufrufen. |

## 14. Demo

`demo/index.html` zeigt einen Materialfluss mit 9 Stationen, einem reinen
Hindernis (QS) und 13 Flüssen in t/Tag. Die Kantenbreite wächst mit der
Wurzel der Menge von 3 px bis 18 px für den größten Fluss
(`demo/flow-width.ts`); so bleiben kleine neben großen Flüssen sichtbar. Im
Stahlwerk ist der größte Fluss die Tagesproduktion der Warmbreitbandstraße
(WBB, 8.000 t); dort enden die Breiten bei 12 px, weil die engsten Lücken
zwischen den Knoten nur 30 px breit sind.

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
| Graph | `Beispiel` oder `Stahlwerk` (76 Knoten, 163 Flüsse und die Gruppen der Anwendung aus `demo/plant-graph.ts`, viele enge Lücken; Doppelklick auf eine einklappbare Gruppe klappt sie ein oder aus; lädt die Seite mit `?graph=plant` neu) |
| beim Ziehen routen | `rerouteOnDrag` |
| Verzögerung | `dragRouteDelay`, Start 600 ms: erst routen, wenn der Knoten so lange ruht, damit langsames Ziehen nicht ständig neu routet |
| Kanten beim Ziehen ausblenden | `hideEdgesOnDrag`, zu Beginn an |
| Label auf längstem Segment | `labelPosition: 'longest-segment'` (Kantenbeschriftung = Menge) |
| Worker | routet in einem Web Worker (`worker`, lädt die Seite mit `?worker=1` neu) |
| Knoten ziehen | Live-Routing |

Unten rechts zeigt die Demo die Werte aus dem Event `avoidrouted`.

Der Code der Demo (`demo/main.ts`) importiert `src`
genau so, wie es ein anderes Projekt tut, und eignet sich als Vorlage.

## 15. Entwicklung

```sh
npm install
npm test            # Tests (node:test), inkl. Integrationstest mit headless Cytoscape
npm run test:e2e    # zieht Knoten der Demo in Chrome (playwright-core, nutzt das installierte Chrome)
npm run lint        # oxlint
npm run deps:check  # Schichtregeln von src/ (.dependency-cruiser.cjs)
npm run deps        # Importgraph von src/ als Mermaid -> docs/dependencies.md
npm run typecheck   # Typprüfung mit tsc (Plugin, Tests, Skripte, Demo)
npm run perf        # Laufzeit des Routing-Kerns
npm run quality     # Überlappungen, Kreuzungen, Knicke, Länge auf den Bench-Graphen
npm run demo        # Demo bündeln + Demo-Server auf http://localhost:8080/demo/
```

Das Plugin importiert seine Dateien ohne `.ts`-Endung, wie es Bundler
erwarten. Node.js führt Tests und Benchmark direkt per Type Stripping aus;
`scripts/ts-resolve.ts` ergänzt dabei die Endung.

Aufbau des Quellcodes (eine Klasse pro Datei, nach Aufgabe in Ordnern):

| Datei | Klasse | Aufgabe |
|---|---|---|
| `index.ts` | – | Öffentliche API: Registrierung von `cy.libavoid()` und die Exporte für Anwendungen. |
| `shared/geometry.ts` | – | `Point`, `Rect`, `Side`, `Axis` und Hilfen dazu (`extentOf`, `halfSize`, `sideFacing`, `sideMiddle`), von allen Teilen genutzt. |
| `shared/graph.ts` | – | Das einfache Datenmodell (`GraphModel`, `GraphNode`, `GraphEdge`), `isObstacle`, `nodesById`, `routableEdges`. |
| `shared/errors.ts` | – | `pluginError()` / `pluginMessage()` mit dem Namen des Plugins, Prüfungen für Optionen. |
| `cytoscape-adapter/libavoid-routing.ts` | `LibavoidRouting` | Plugin: auf Änderungen hören, routen (im Haupt-Thread oder im Worker), Ergebnisse anwenden. |
| `cytoscape-adapter/options.ts` | – | `LibavoidOptions`, `defaults`, `RoutedEventInfo`. |
| `cytoscape-adapter/snapshot.ts` | – | Liest das Modell aus `cy` (sichtbare Hindernisse und Kanten). |
| `cytoscape-adapter/route-style.ts` | – | Route ↔ Cytoscape-Style (reine Geometrie), Beschriftungsposition. |
| `cytoscape-adapter/edge-styler.ts` | `EdgeStyler` | Setzt und entfernt die Styles auf den Kanten. |
| `cytoscape-adapter/route-scheduler.ts` | `RouteScheduler` | Wann neu geroutet wird: höchstens einmal pro Frame, beim Ziehen nach `dragRouteDelay` und mit Pause nach `dragRouteInterval`. Kennt Cytoscape nicht. |
| `cytoscape-adapter/drag-tracker.ts` | `DragTracker` | Welche Knoten gerade gezogen werden, aus den Events `grab`, `free` und `remove`. |
| `routing/edge-router.ts` | `EdgeRouter` | Routing-Logik. Kennt nur das einfache Modell, nicht Cytoscape. |
| `routing/options.ts` | – | `RoutingOptions`, ihre Standardwerte und ihre Prüfung. |
| `routing/routing-backend.ts` | – | Schnittstelle `RoutingBackend`: wo geroutet wird. Das Plugin kennt nur sie. |
| `routing/local-router.ts` | `LocalRouter` | `RoutingBackend` im Haupt-Thread, mit `EdgeRouter`. |
| `postprocess/simplify.ts` | – | Rundet libavoids Punkte und entfernt überflüssige. |
| `postprocess/run.ts` | `Run` | Ein gerades Stück einer Route: Lage, Ausdehnung, Überlappung, Kreuzung, Spielraum an der Knotenseite. |
| `postprocess/run-index.ts` | `RunIndex` | Räumlicher Index der Runs, damit Nachbarn ohne Vergleich aller Paare gefunden werden. |
| `postprocess/route-geometry.ts` | `RouteGeometry` | Routen in Runs zerlegt, mit Index; gemeinsame Abfragen (Bündel, freie Intervalle, Hindernisse neben einem Run). Wird pro libavoid-Lauf einmal gebaut. |
| `postprocess/overlap-separator.ts` | – | `separateOverlapsIn(geometry)`: schiebt übereinanderliegende Segmente auseinander (siehe 10.4). |
| `postprocess/detour-finder.ts` | – | `findDetoursIn(geometry)`: Umwege für überfüllte Lücken (siehe 10.4). |
| `postprocess/route-quality.ts` | – | `measureQuality(geometry)`: Überlappung, Kreuzungen und Länge, zum Vergleichen. |
| `libavoid/load.ts` | – | Lädt die `.wasm` einmalig. |
| `libavoid/api.ts` | – | Typen des genutzten Teils der libavoid-js-API. |
| `libavoid/libavoid-session.ts` | `LibavoidSession` | Ein Routing-Lauf mit der libavoid-API, gibt danach deren Speicher frei. |
| `worker/messages.ts` | – | Nachrichten zwischen Plugin und Worker (`RouteRequest`, `RouteResponse`) und `RoutingWorker`, der Teil eines Workers, der sie sendet und empfängt. |
| `worker/answer-route-request.ts` | – | `answerRouteRequest()`: die Seite des Workers, beantwortet eine Anfrage. |
| `worker/worker-router.ts` | `WorkerRouter` | `RoutingBackend` im Worker: schickt Anfragen und ordnet die Antworten zu. |
| `routing.worker.ts` | – | Einstieg des Web Workers: beantwortet `RouteRequest`s mit `answerRouteRequest()`. |

Wichtig beim Arbeiten mit libavoid-js: Jedes mit `new` erzeugte Objekt liegt im
WebAssembly-Speicher und muss mit `.delete()` freigegeben werden. Dasselbe gilt
für Objekte, die Methoden zurückgeben: libavoid-js nutzt embind, das Kopien
herausgibt, z. B. `displayRoute()` (eine `PolyLine`) und `at(i)` (ein `Point`).

All das übernimmt `LibavoidSession`: Hilfsobjekte merkt sie sich und gibt sie in
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
