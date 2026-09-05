# ShiftWatch Kalender

Versjon 2.2.0 viser dine kommende vakter med mørkeblått omriss i kalenderen.
Bygger på GitHub main `12f9152ffa63e485b7fb8db6cf9505766e55d444` (kontrollert 05.09.2026).
Beholder agentkontrollen fra 2.1.0 og Safari/WebKit-rettingen fra 2.0.1.

## Mine vakter (nytt i 2.2.0)

Etter **Hent siste kalender** vises først sist lagrede vaktoversikt fra OneDrive.
Frontenden sender deretter en ping og velger én responderende agent som støtter
vakthenting. Den agenten får en kortlivet forespørsel om å lese hele tabellen på
**Mine kommende vakter**. Kalenderen kan redigeres og publiseres mens du venter.
**Oppdater vakter** gjentar hentingen uten å laste inn kalenderkriteriene på nytt.

- Mørkeblått indre omriss viser vaktdatoen. Fyllfargen for kriterier beholdes;
  valgt dato har fremdeles lilla ytre markering.
- Flere vakter samme dato gir et antallsmerke. Velg datoen eller et datointervall
  for å se tid, type og arbeidssted under **Markering**. Detaljer finnes også i
  datoens tooltip og skjermlesertekst.
- Alle datoer i agentens resultat beholdes, også flere år fremover. Bruk
  årspilene for å se dem. Nattvakter markeres på startdatoen slik den står på
  nettstedet, med «til neste dag» i detaljene.
- Sist hentet-tidspunkt vises alltid. Oversikter eldre enn ett døgn merkes.
  Feil/timeout/ingen agent bevarer siste gyldige oversikt; bare et validert,
  fullstendig tomt resultat fjerner alle vakter.
- Vaktoversikten er separat fra kalenderkriteriene og endrer aldri claiming,
  ekskluderinger eller det som sendes med **Publiser kalender**.
- Ingen HTML, legevakt-passord eller sesjonscookies sendes til frontenden.
  Vaktdata lagres av agenten i samme private OneDrive App Folder. Frontenden
  holder den viste oversikten i minnet, og tømmer den ved frakobling.

**Agentoppdatering kreves:** v110 støtter ikke `owned_shifts_v1`. Denne ZIP-en
inneholder bare frontenden. Inntil agentdelen installeres vises en forklaring
om at responderende agenter må oppdateres. Vanlig kalenderhenting og
agentkontroll fungerer fortsatt. Ingen nye Azure-tillatelser er nødvendig.

Den nøyaktige kontrakten for neste agentoppdatering finnes i
[docs/owned-shifts-protocol.md](docs/owned-shifts-protocol.md).
Nettstedets tabell er kilden; frontenden påstår ikke at en bestemt datoperiode
er kontrollert hvis serveren ikke leverer den.

En statisk, responsiv kalendereditor som henter og publiserer ShiftWatch sine
seks delte kalenderfelt direkte i OneDrive App Folder via Microsoft Graph.
Nettsiden har ingen backend og fungerer fra både PC og mobil.

## Arbeidsflyt

1. Trykk **Hent siste kalender**.
2. Fullfør Microsoft-innlogging første gang. Hentingen fortsetter automatisk
   når nettleseren kommer tilbake til siden.
3. Rediger perioder, eksakte inkluderinger og ekskluderte datoer.
4. Trykk **Publiser kalender**.

## Agentkontroll

Etter Microsoft-innlogging kan frontenden også:

- sende **Pause alle** og **Gjenoppta alle** til eksisterende ShiftWatch-agenter;
- sende **Ping alle** og samle svar i et eget statusvindu i 20 sekunder;
- vise agentnavn, stabil agent-ID og svartid;
- vise individuelle **Pause**/**Gjenoppta**-knapper på hver agentrad.

De tre globale handlingene bruker den eksisterende v109-protokollen.
Agent v110 viser aktiv/pauset-status og støtter individuelle knapper gjennom
`targeted_control_v1`. Eldre agentsvar uten status vises som `Status ukjent`,
og individuelle knapper er deaktivert hvis agenten mangler denne støtten.

Ping bekrefter bare hvem som svarte. Manglende svar kan skyldes at PC-en eller
agenten er stoppet, manglende nett, eller en midlertidig Graph-feil; frontenden
betegner derfor ikke et manglende svar som sikkert «offline».

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
