# poc_Raumgestalter

Proof of Concept: Plan, Skizze oder Foto plus Maße → virtueller 3D-Raum → Fliesen wählen → Mengenliste.

**Die KI erkennt, der Code rechnet.** Claude (Bildverständnis) liest Wände, Türen, Fenster und Ausstattung aus dem Bild
und liefert strukturierte Daten. Maßstab, Fliesenschnitt, Muster, Verschnitt und Mengen berechnet das Programm selbst.

## Starten

```bash
cd poc_Raumgestalter
pip install -r requirements.txt
cp .env.example .env        # dann ANTHROPIC_API_KEY eintragen
python app.py               # http://127.0.0.1:5057
```

Ohne Key läuft der **Demo-Modus**: Vorlagen, 3D, Fliesen, Mengen und ein Stichwort-Chat funktionieren. Plan-Erkennung und
freier Chat brauchen den Key.

## Bedienung (für Laien gedacht)

1. **Plan und Maße**: Bild hochladen, Skizze zeichnen oder Vorlage wählen. Länge/Breite angeben.
2. **Raum prüfen**: Ecken ziehen, Zahlen antippen, Türen/Fenster/Möbel verschieben oder hinzufügen.
3. **Fliesen wählen**: Fläche antippen, Fliese, Muster, Fuge, Höhe, Wandfarbe. Stil-Schnellstart und Assistent (Chat).
4. **Ergebnis**: Mengen inkl. Verschnitt, Fugenmasse, Kleber, Leisten und Kosten (Beispielpreise). Optional erzeugt Replicate drei realistische Ansichten der fertigen Gestaltung. Export: PNG, CSV, PDF/Druck, Projekt (JSON).

Tasten: Strg+Z / Strg+Umschalt+Z, R (Möbel drehen), Entf, Pfeiltasten. Test-Link: `/?demo=bad-wanne&step=3&style=hotel`.

## Aufbau

| Teil | Datei |
|---|---|
| Server, Claude-Aufrufe (`submit_room`, `apply_changes`), Skalierung, Fallback-Chat | `app.py` |
| Katalog (Fliesen, Muster, Fugen, Farben, Stile) | `data/catalog.json` |
| Raum-Geometrie, Bereinigung, Vorlagen | `static/js/room.js` |
| Design-Zustand, Verlegeoptimierung, Mengen | `static/js/design.js` |
| Fliesen-Texturen (Look, Fuge, Muster) | `static/js/tilegen.js` |
| 3D (Three.js, lokal eingebunden) | `static/js/scene3d.js`, `fixtures3d.js` |
| 2D-Editor | `static/js/editor2d.js` |
| Oberfläche | `ui-capture.js`, `ui-edit.js`, `ui-design.js`, `ui-result.js`, `chat.js`, `main.js` |

Einheit überall Zentimeter. Kein Build-Schritt, keine Cloud-Schriften oder CDNs.

### Raumfoto und realistische Ansichten

Im ersten Schritt kann statt eines Plans ein Raumfoto aufgenommen oder hochgeladen werden. Claude rekonstruiert daraus eine ungefähre Draufsicht mit Wänden, Öffnungen und Ausstattung. Im 2D-Prüfschritt müssen besonders Maße und verdeckte Bereiche kontrolliert werden; ein einzelnes Foto kann keine verlässliche maßstäbliche Geometrie liefern.

Für optionale fotorealistische Entwurfsbilder `REPLICATE_API_TOKEN` in `.env` eintragen. Standardmodell ist `google/nano-banana`; `REPLICATE_MODEL` kann auf ein anderes kompatibles Replicate-Modell gesetzt werden. Im Ergebnis-Schritt startet eine ausdrückliche Aktion drei kostenpflichtige Bildgenerierungen. An Replicate wird dafür ein komprimierter Screenshot der 3D-Planung gesendet. Die erzeugten Bilder sind Visualisierungen und keine maßstabsgetreue Zusicherung.

## Eigene Fliesen einbinden

`data/catalog.json` ersetzen. Pro Fliese: `id`, `name`, `series`, `look` (uni, marmor, travertin, beton, holz, schiefer, zellige, terrazzo),
`color`, `size` [cm], `thickness` [mm], `pcsPerBox`, `boxM2`, `priceM2`, `use` (boden/wand/beide), `finish`. Echte Herstellerdaten
(BIM, DATANORM, BMEcat) lassen sich in dieses Format umwandeln; Fotos als Textur wären der nächste Ausbauschritt.

## Grenzen des POC

- Katalog und Preise sind Beispieldaten. Texturen sind prozedural, keine Herstellerfotos.
- Erkennung hängt von der Planqualität ab; Raumfotos sind besonders unsicher. Deshalb Schritt 2 immer prüfen.
- Mengenformeln sind Richtwerte (Verschnitt je Muster, Fuge nach Herstellerformel).
- Nur ein Raum, gerade Wände, Standard-Ausstattung.
- Der Server hat ein einfaches Rate-Limit, aber keine Nutzerverwaltung. Nicht ungeschützt ins Internet stellen.
