# ShiftWatch Kalender

En komplett, statisk og responsiv frontend for å lese en hel ShiftWatch
`config.yaml`, redigere kalenderkriteriene visuelt og kopiere et robust
kalenderkommandoformat.

Appen har ingen backend, ingen innlogging, ingen analyseverktøy og ingen eksterne
runtime-avhengigheter. YAML-filen behandles lokalt i nettleseren.

## Funksjoner

- Leser en komplett `config.yaml` fra tekstfeltet.
- Laster `config/default-config.yaml` automatisk når siden åpnes.
- Filtrerer ut bare de seks delte kalenderfeltene internt.
- Viser perioder i grønt, eksakt inkluderte datoer i blått, ekskluderte datoer
  i rødt og fortidsdatoer i grått.
- Lar brukeren markere en dato eller et datointervall med mus eller berøring.
- Kan legge til perioder med valgte ukedager, inkludere datoer eksakt,
  ekskludere datoer og fjerne overrides.
- Har responsiv visning: tre måneder per rad på stor PC-skjerm, to på nettbrett
  og én på mobil.
- `Copy` lager et Base64URL-kodet JSON-dokument med SHA-256-kontrollsum.
- Kan også kopiere en oppdatert full config hvor øvrige innstillinger beholdes.
- Kan installeres som PWA og fungerer offline etter første lasting.

## Tema som skal brukes

Bruk nøyaktig dette temaet sammen med innholdet fra `Copy`:

```text
Shiftwatch changes
```

Temaet vises også som et lite hjelpefelt ved Copy-knappen.

## Endre standardkalenderen i repoet

Rediger:

```text
config/default-config.yaml
```

Nettsiden forsøker å hente denne filen uten nettlesercache ved hver åpning.
Bare følgende felter under `criteria` påvirker kalenderen og Copy-resultatet:

- `allowed_date_ranges`
- `date_start`
- `date_end`
- `blocked_weekdays`
- `extra_include_dates`
- `exclude_dates`

Alle andre felter beholdes bare i nettleserminnet slik at «Kopier oppdatert full
config» kan lage en hel fil igjen.

Ikke legg passord, token-cache eller andre hemmeligheter i en config som ligger
i et offentlig repo. Appen trenger ingen slike verdier.

## Publisering som statisk GitHub-side

Repoet kan publiseres direkte fra rotmappen fordi `index.html` ligger øverst.
Velg branch-basert GitHub Pages-publisering fra hovedbranchen og rotmappen.
Filen `.nojekyll` er allerede inkludert.

Det kreves ingen build-kommando og ingen serverkode.

## Lokal kjøring

Installer Node.js 20 eller nyere og kjør:

```bash
npm install
npm run serve
```

Åpne adressen som vises i terminalen. Direkte åpning av `index.html` via
`file://` fungerer også, men nettleseren kan da blokkere automatisk lasting av
repo-configen. Appen bruker i så fall en innebygd fallback-config.

## Tester

```bash
npm test
```

Testene kontrollerer filtrering av full config, fargeprioritet, kalenderendringer,
bevaring av lokale config-felter og roundtrip av det kopierte kommandoformatet.

## Kommandoformat

Copy-resultatet har dette formatet:

```text
SHIFTWATCH-CALENDAR-COMMAND-V1
PAYLOAD-BEGIN
<Base64URL-kodet JSON>
PAYLOAD-END
SHA256:<kontrollsum>
```

JSON-dokumentet inneholder schema-versjon, unik kommando-ID, UTC-tidspunkt og
bare kalenderkriteriene. SHA-256 oppdager korrupsjon i kopiering eller transport,
men er ikke en autentiseringsmekanisme.

## Viktig om agenten

Denne første repo-versjonen bygger bare frontend-applikasjonen. Eksisterende
ShiftWatch v106 gjenkjenner ikke kalenderkommandoen ennå. Agentstøtten for tema,
dekoding, validering og publisering til OneDrive må legges inn i en senere
ShiftWatch-oppdatering.

## Personvern

Appen sender ingen data. Den eneste nettverkstrafikken er lasting av statiske
filer fra samme nettsted. YAML-parseren ligger lokalt i `vendor/` og hentes ikke
fra et CDN.

## Lisens

Selve repoet er MIT-lisensiert. `js-yaml` distribueres under sin egen MIT-lisens,
som følger med i `vendor/js-yaml.LICENSE`.

