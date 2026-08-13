# ShiftWatch Kalender

En statisk, responsiv kalendereditor som henter og publiserer ShiftWatch sine
seks delte kalenderfelt direkte i OneDrive App Folder via Microsoft Graph.
Nettsiden har ingen backend og fungerer fra både PC og mobil.

## Arbeidsflyt

1. Trykk **Hent siste kalender**.
2. Fullfør Microsoft-innlogging første gang. Hentingen fortsetter automatisk
   når nettleseren kommer tilbake til siden.
3. Rediger perioder, eksakte inkluderinger og ekskluderte datoer.
4. Trykk **Publiser kalender**.

Kjørende ShiftWatch-agenter plukker opp den overskrevne
`shiftwatch_calendar_config.json`-filen ved neste OneDrive-poll. Senere
oppstartede agenter henter den samme persistente kalenderen.

## Første gangs Microsoft-oppsett

Frontend og agent må bruke samme Application/Client ID. Den ligger i:

```text
src/onedrive-config.js
```

Client ID er en offentlig app-identifikator, ikke et passord eller en hemmelig
nøkkel.

Legg GitHub Pages-adressen inn i den eksisterende Microsoft-appregistreringen:

1. Åpne **Microsoft Entra admin center → App registrations → ShiftWatch → Authentication**.
2. Velg **Add a platform → Single-page application**.
3. Legg inn:

   ```text
   https://scottyboa.github.io/Shiftwatch-frontend/
   ```

4. Lagre. Behold eksisterende **Mobile and desktop applications**-oppsett; det
   brukes fortsatt av Python-agentens device-code-login.
5. Appen bruker delegated scope `Files.ReadWrite.AppFolder` og authority
   `consumers` for personlig Microsoft-konto.

Redirect URI må være helt lik adressen nettleseren faktisk bruker, inkludert
store/små bokstaver og avsluttende `/`. Lokal Microsoft-login krever at en egen
localhost-adresse registreres som SPA redirect URI.

## Personvern og sikkerhet

- Microsoft-passordet behandles bare på Microsofts innloggingsside.
- Ingen e-postadresse, client secret, access token eller OneDrive-data ligger i
  det offentlige repoet.
- Token-cache bruker `sessionStorage` og er begrenset til nettleserøkten.
- En annen besøkende kan bare koble nettsiden til sin egen Microsoft-konto og
  sin egen appmappe, ikke din.
- `Files.ReadWrite.AppFolder` begrenser Graph-tilgangen til ShiftWatch-appens
  egen OneDrive-mappe.
- Publisering bruker den nøytrale kilden `ShiftWatch Frontend`, ikke PC-navn.
- Før publisering sammenlignes OneDrive-`eTag`. Hvis en annen agent har
  oppdatert kalenderen siden henting, må brukeren eksplisitt velge om den skal
  overskrives.

## Responsivt grensesnitt

- Stor skjerm: tre måneder per rad og fast redigeringspanel.
- Nettbrett: to måneder per rad.
- iPhone/mobil: én måned per rad, større datoknapper og fullbreddes handlinger.

Alle funksjoner – Microsoft-login, henting, redigering og publisering – bruker
samme kildekode på PC og mobil.

## Publisering med GitHub Pages

Publiser hovedbranchens rotmappe. `index.html` ligger i repo-roten og `.nojekyll`
er inkludert. Det kreves ingen build-kommando eller serverkode.

## Lokal kjøring og tester

Krever Node.js 20 eller nyere:

```bash
npm install
npm run serve
```

Kjør testene med:

```bash
npm test
```

`@azure/msal-browser` og den tilhørende lisensen er vendoret under `vendor/`,
slik at produksjonssiden ikke trenger et tredjeparts-CDN.

## Lisens

Selve repoet er MIT-lisensiert. Microsoft Authentication Library distribueres
under sin egen MIT-lisens i `vendor/msal-browser.LICENSE`.
