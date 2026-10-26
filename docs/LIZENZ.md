# cytoscape-libavoid – Lizenzrechtliche Hinweise

Stand: 26.10.2026 · gilt für cytoscape-libavoid 0.1.0 (TypeScript-Quellen in `src/`) mit libavoid-js 0.5.0-beta.5

> **Keine Rechtsberatung.** Dieses Dokument fasst die Lizenzlage aus
> technischer Sicht zusammen und zeigt, was im Projekt zu beachten ist. Vor
> einer kommerziellen Weitergabe oder bei Unsicherheit sollte eine
> fachkundige Stelle (Rechtsabteilung, Anwalt für IT-Recht) die Punkte
> prüfen. Maßgeblich ist immer der Lizenztext selbst
> (`licenses/LGPL-2.1.txt`).

---

## 1. Kurzfassung

- Das Plugin selbst ist eigener Code und steht unter der **MIT-Lizenz**
  (`LICENSE`, © 2026 Philipp Kabala).
- Der Kern, **libavoid** und die JavaScript-Portierung **libavoid-js**, steht
  unter der **GNU Lesser General Public License 2.1 oder später (LGPL-2.1+)**.
- Die LGPL ist eine schwache Copyleft-Lizenz. Sie erlaubt die Nutzung in
  eigener, auch proprietärer und kommerzieller Software. Wer die Bibliothek
  **weitergibt**, muss aber Bedingungen erfüllen: Lizenzhinweis, Lizenztext,
  Zugang zum Quellcode der Bibliothek und die Möglichkeit, die Bibliothek
  auszutauschen.
- **Eine Webanwendung gilt als Weitergabe**, denn der Browser lädt
  `libavoid.wasm` und den JavaScript-Code der Bibliothek herunter.
- **Rein interne Nutzung** ohne Weitergabe an Dritte löst keine Pflichten aus.
- Änderungen **an libavoid/libavoid-js selbst** müssen wieder unter der LGPL
  stehen. Der eigene Anwendungscode muss es nicht.
- Für libavoid bietet die Monash University eine **kommerzielle Lizenz**
  an. Sie deckt aber nur libavoid ab, nicht die Portierung libavoid-js.

---

## 2. Welche Komponenten stecken drin?

| Komponente | Lizenz | Rechteinhaber | Wo |
|---|---|---|---|
| **cytoscape-libavoid** (eigener Code) | MIT | Philipp Kabala | `src/`, wird in die Anwendung kompiliert |
| **libavoid-js** 0.5.0-beta.5 (JS-Bindings, Build) | LGPL-2.1-or-later | Vladyslav Hnatiuk und Mitwirkende | npm-Abhängigkeit, wird vom Bundler der Anwendung mitgebündelt; `libavoid.wasm` als eigene Datei |
| **libavoid** (C++, aus Adaptagrams) | LGPL-2.1-or-later, zusätzlich kommerziell lizenzierbar | Monash University | kompiliert in `libavoid.wasm` |
| **Emscripten-Laufzeit** (Teil des libavoid-js-Codes) | MIT / NCSA | Emscripten-Autoren | im JS-Code von libavoid-js |
| **Cytoscape.js** | MIT | The Cytoscape Consortium | npm-Abhängigkeit der Anwendung; im Repo nur im Demo-Build (`demo/build/`) |
| **esbuild** | MIT | Evan Wallace | nur Build-Werkzeug, wird nicht ausgeliefert |

Das Repository selbst enthält keinen Code von libavoid oder libavoid-js. Er
kommt erst beim Bauen einer Anwendung (oder der Demo) aus `node_modules` hinzu.

Belege:
- libavoid-js: `"license": "LGPL-2.1-or-later"` in der `package.json`, Lizenztext
  `LICENSE` = LGPL 2.1.
- libavoid: Dateikopf von `libavoid.h`: *„Copyright (C) 2004-2009 Monash
  University … under the terms of the GNU Lesser General Public License …
  either version 2.1 of the License, or (at your option) any later version."*
- Adaptagrams-README: *„All code in the Adaptagrams repository is released as
  open source software under the terms of the LGPL 2.1 or later"* und *„We
  also dual-license the Adaptagrams libraries … under a less-restrictive
  commercial license"*.

**Besonderheit:** libavoid-js baut nicht auf dem Original-Repository
`mjwybrow/adaptagrams` auf, sondern auf dem Fork `Aksem/adaptagrams`, Tag
`v1.0.4`, und patcht beim Build zusätzlich eine Datei
(`cola/libavoid/hyperedgeimprover.h`). Die ausgelieferte `libavoid.wasm` ist
also eine **veränderte Fassung** von libavoid. Für die LGPL ändert das nichts
an den Pflichten, wohl aber daran, welcher Quellcode genau bereitzustellen
ist (siehe 5.3).

---

## 3. Was die LGPL-2.1 grundsätzlich regelt

Die LGPL unterscheidet zwei Arten von Code:

1. **Die Bibliothek selbst** (libavoid, libavoid-js) und Änderungen daran.
   Sie bleibt LGPL. Wer sie verändert und weitergibt, muss die Änderungen
   ebenfalls unter der LGPL im Quellcode bereitstellen (§ 2).
2. **„Ein Werk, das die Bibliothek nutzt"**: Ihr Plugin und Ihre Anwendung.
   Es darf unter einer **beliebigen Lizenz** stehen, auch proprietär. Bei der
   Weitergabe zusammen mit der Bibliothek gelten aber die Bedingungen aus § 6.

### Was ist erlaubt?

- Nutzung für jeden Zweck, auch kommerziell
- Einbindung in proprietäre Software
- Verkauf der eigenen Software, die libavoid nutzt
- Änderungen an libavoid, wenn diese wieder unter der LGPL stehen

### Was wird bei Weitergabe verlangt? (§ 6 LGPL-2.1)

| Pflicht | Bedeutung |
|---|---|
| **Hinweis** | An gut sichtbarer Stelle angeben, dass die Bibliothek verwendet wird und unter der LGPL steht. |
| **Lizenztext** | Eine Kopie der LGPL-2.1 beilegen. |
| **Copyright-Vermerke** | Vorhandene Copyright-Hinweise der Bibliothek erhalten. |
| **Quellcode der Bibliothek** | Den vollständigen Quellcode der verwendeten Bibliotheksversion, inklusive Änderungen, mitliefern, schriftlich anbieten (mindestens 3 Jahre gültig) oder bei Weitergabe über das Netz gleichwertig am selben Ort zum Download bereitstellen. |
| **Austauschbarkeit** | Empfänger müssen die Bibliothek durch eine geänderte Fassung ersetzen und Ihr Werk damit weiter nutzen können. Das geht entweder über einen geeigneten Mechanismus zum separaten Laden (§ 6 b) oder, indem Sie Ihr Werk in einer neu verlinkbaren Form bereitstellen (§ 6 a). |
| **Keine Verbote** | Ihre Lizenzbedingungen dürfen Änderungen für den Eigengebrauch und Reverse Engineering zur Fehlersuche an diesen Änderungen nicht verbieten. Das betrifft auch proprietäre EULAs. |
| **Keine Zusatzbeschränkungen** | Für die Bibliothek selbst dürfen keine Einschränkungen über die LGPL hinaus auferlegt werden. |

### Haftung und Gewährleistung

Die LGPL schließt Gewährleistung und Haftung der Autoren so weit wie gesetzlich
möglich aus (§§ 15, 16). Gegenüber den eigenen Kunden haften Sie nach Ihren
eigenen Verträgen. Der Ausschluss der Bibliotheksautoren entlastet Sie dabei
nicht.

---

## 4. Wann greifen die Pflichten? Typische Szenarien

| Szenario | Weitergabe? | Pflichten aus der LGPL |
|---|---|---|
| Nutzung nur im eigenen Unternehmen (Intranet, eigene Mitarbeiter) | nein (strittig bei Weitergabe an Konzerngesellschaften) | keine. Hinweise trotzdem sinnvoll. |
| Routing nur serverseitig in Node.js, Kunden sehen nur das Ergebnis (z. B. ein SVG) | nein | keine. Die LGPL-2.1 hat keine Netzwerk-Klausel wie die AGPL. |
| **Öffentliche oder Kunden-Webanwendung**, Browser lädt das Plugin | **ja** | **alle aus Abschnitt 3** |
| Gebaute Anwendung (Bundle + `libavoid.wasm`) an Kunden oder Partner geben | **ja** | **alle aus Abschnitt 3** |
| Nur die Plugin-Quellen (`src/`) weitergeben | nein, sie enthalten keinen LGPL-Code | keine für libavoid; libavoid-js kommt beim Empfänger von npm (siehe 6.2) |
| Desktop-App (z. B. Electron) mit dem Plugin | **ja** | alle |
| Änderungen am libavoid-C++-Code oder an libavoid-js | – | zusätzlich: Änderungen unter LGPL im Quellcode bereitstellen |

---

## 5. Stand im Projekt (Prüfung vom 16.10.2026)

### 5.1 Bereits erledigt

| Punkt | Umsetzung |
|---|---|
| Lizenztext beilegen | `licenses/LGPL-2.1.txt` (Original aus libavoid-js) |
| Hinweis auf verwendete Bibliotheken | `THIRD-PARTY-NOTICES.md` mit Komponenten, Versionen, Rechteinhabern, Lizenzen und Quellen |
| Hinweis im Bundle | `libavoid.ts` beginnt mit einem `/*! … */`-Kommentar, der libavoid-js und libavoid mit Lizenz nennt. Das `!` sorgt dafür, dass esbuild und gängige Minifier den Kommentar in das Bundle übernehmen (geprüft am Demo-Build). Angular entfernt Lizenzkommentare aus dem Bundle und schreibt stattdessen `3rdpartylicenses.txt`, das libavoid-js mit vollem LGPL-Text enthält (geprüft am Bench-Build). |
| Cytoscape (MIT) in der Demo | Der Lizenzkopf von Cytoscape bleibt im Demo-Bundle erhalten, zusätzlich liegt `licenses/cytoscape-MIT.txt` bei. |
| Austauschbarkeit (§ 6 a) | Plugin-Quellcode liegt bei, libavoid-js ist eine normale npm-Abhängigkeit. Mit einem eigenen libavoid-js lässt sich die Anwendung neu bauen. `libavoid.wasm` wird als eigene Datei geladen. |

### 5.2 Erledigt: Lizenz für den eigenen Plugin-Code

Der eigene Code steht unter der **MIT-Lizenz** (`LICENSE`, `"license": "MIT"`
in `package.json`). MIT ist im Cytoscape-Umfeld üblich und mit der LGPL von
libavoid vereinbar: Der Plugin-Code ist ein „Werk, das die Bibliothek nutzt“
und darf eigenständig lizenziert sein. Die `LICENSE`-Datei stellt klar, dass
mitgebündelte Fremdkomponenten (z. B. im Demo-Build) ihre eigenen Lizenzen
behalten.

### 5.3 Offen: Quellcode der Bibliothek bereitstellen

Für eine Weitergabe muss der **genaue** Quellcode zur ausgelieferten
`libavoid.wasm` und dem libavoid-js-Code zugänglich sein. Problem:

- libavoid-js **0.5.0-beta.5** hat auf GitHub **keinen Git-Tag**. Die neuesten
  Tags sind `v0.4.x`. Welcher Commit der npm-Version entspricht, ist nicht
  belegt.
- libavoid stammt aus dem Fork `Aksem/adaptagrams`, Tag `v1.0.4`, plus Patch
  aus `tools/generate.py`.

Ein bloßer Link auf die GitHub-Startseiten reicht dafür nicht sicher aus.
Empfohlenes Vorgehen:

1. Den Commit von libavoid-js ermitteln, der 0.5.0-beta.5 entspricht (Autor
   fragen oder Commit-Historie um das npm-Veröffentlichungsdatum prüfen).
2. Ein Quellarchiv erstellen mit
   - libavoid-js in diesem Stand (inklusive `tools/`, Bindings, Build-Skripten),
   - `Aksem/adaptagrams` Tag `v1.0.4`,
   - einer kurzen Anleitung, wie daraus `libavoid.wasm` gebaut wird.
3. Das Archiv mitliefern oder neben der Anwendung zum Download anbieten
   (§ 6 d) und in `THIRD-PARTY-NOTICES.md` darauf verweisen.

Alternativ: libavoid-js selbst aus einem fest benannten Commit bauen. Dann
ist der Quellstand eindeutig.

### 5.4 Empfohlen: Hinweis in der Anwendung

Für Webanwendungen gilt der Hinweis „an gut sichtbarer Stelle" nicht schon
dadurch als erfüllt, dass ein Kommentar im Quelltext steht. Üblich ist eine
Seite oder ein Dialog „Open-Source-Lizenzen" bzw. „Über", der den Inhalt von
`THIRD-PARTY-NOTICES.md` zeigt und auf den LGPL-Text und das Quellarchiv
verlinkt.

---

## 6. Technische Stellschrauben

### 6.1 libavoid-js im Bundle der Anwendung

Der Bundler der Anwendung packt den JavaScript-Teil von libavoid-js in das
Anwendungs-Bundle, nur die `.wasm` liegt separat. Der JS-Teil und die `.wasm`
werden gemeinsam generiert und gehören zusammen. Wer die Bibliothek
austauschen will, muss also die Anwendung neu bauen. Das ist nach § 6 a
zulässig, wenn der Empfänger dafür Quellcode bzw. neu verlinkbare Objektdateien
und das Build-Verfahren der Anwendung erhält.

Sauberer im Sinne von § 6 b wäre, libavoid-js als **eigene Datei**
auszuliefern, die zur Laufzeit geladen wird (im Bundler als `external`
markieren und separat einbinden). Dann lässt sich die Bibliothek einfach durch
Austausch zweier Dateien ersetzen, ohne etwas neu zu bauen.

### 6.2 Plugin-Quellen ohne Bibliothek

Die Plugin-Quellen in `src/` enthalten keinen LGPL-Code; libavoid-js
kommt über `npm install libavoid-js` direkt vom Original. Die Pflichten aus
§ 6 liegen damit bei dem, der am Ende die fertige Anwendung ausliefert.

### 6.3 Pflichten des Anwendungsbetreibers

Wer das Plugin in eine Anwendung einbaut, bündelt libavoid-js selbst mit und
trägt die Pflichten aus Abschnitt 3. Im eigenen Produktions-Build prüfen, dass
der `/*! … */`-Hinweis erhalten bleibt (bei esbuild Standard, bei Terser
o. Ä. ggf. `comments: /^!/` setzen). Angular liefert stattdessen
`3rdpartylicenses.txt` mit aus; diese Datei muss mit veröffentlicht werden.

---

## 7. Kommerzielle Alternative

Monash University bietet die Adaptagrams-Bibliotheken, also auch libavoid,
gegen Gebühr unter einer **weniger restriktiven kommerziellen Lizenz** an
(siehe Adaptagrams-README).

Zu beachten:

- Die kommerzielle Lizenz deckt **libavoid (C++)** ab, aber **nicht
  libavoid-js** (Bindings und Build von Vladyslav Hnatiuk). Für eine komplett
  LGPL-freie Lösung bräuchte es zusätzlich eine Vereinbarung mit dem Autor von
  libavoid-js oder eigene Bindings.
- libavoid-js baut auf einem Fork mit Patch auf. Für die kommerzielle Variante
  wäre zu klären, ob dieser Stand von der Lizenz abgedeckt ist.
- Sinnvoll ist das vor allem, wenn die LGPL-Pflichten in einem Produkt nicht
  erfüllbar sind, etwa weil Austauschbarkeit oder Reverse Engineering
  vertraglich ausgeschlossen werden müssen.

---

## 8. Checkliste vor einer Weitergabe

- [x] Lizenz für den eigenen Plugin-Code festgelegt: MIT, `package.json` und `LICENSE` angepasst (5.2)
- [ ] `licenses/LGPL-2.1.txt` und `THIRD-PARTY-NOTICES.md` werden mit der Anwendung mitgeliefert
- [ ] Lizenzhinweis aus `libavoid.ts` bleibt im Produktions-Build der Anwendung erhalten (6.3)
- [ ] Quellarchiv von libavoid-js (exakter Stand) und Adaptagrams-Fork bereitgestellt (5.3)
- [ ] Sichtbarer Hinweis in der Anwendung („Open-Source-Lizenzen") (5.4)
- [ ] Eigene EULA / AGB verbieten keine Änderungen für den Eigengebrauch und kein Reverse Engineering zur Fehlersuche (Abschnitt 3)
- [ ] Bei Änderungen an libavoid oder libavoid-js: Änderungen unter LGPL im Quellcode bereitgestellt
- [ ] Bei Unsicherheit oder kommerziellem Vertrieb: rechtliche Prüfung

---

## 9. Quellen

- GNU LGPL 2.1, Volltext: `licenses/LGPL-2.1.txt` · https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
- libavoid-js: https://github.com/Aksem/libavoid-js (`package.json`, `LICENSE`, `tools/generate.py`)
- Adaptagrams (libavoid): https://github.com/mjwybrow/adaptagrams (README, Dateiköpfe)
- Adaptagrams-Fork für libavoid-js: https://github.com/Aksem/adaptagrams (Tag `v1.0.4`)
- Cytoscape.js: https://github.com/cytoscape/cytoscape.js (`LICENSE`, MIT)
