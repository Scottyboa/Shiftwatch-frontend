# ShiftWatch Kalender

Versjon **2.3.1** retter publisering av ukevalg til personlig OneDrive.
Bygger på det komplette v2.2.0-repoet og beholder kalender, Mine vakter,
agentkontroll og Safari/WebKit-retting. Ingen endringer er publisert til GitHub.

## Rettet i 2.3.1

- **Publiser ukevalg** bruker nå Microsoft Graphs vanlige innholdsopplasting for
  den lille JSON-filen. Dette retter HTTP 400-feilen fra opplastingsøkten.
- Samtidighetsbeskyttelsen er beholdt: en endret eksisterende fil overskrives
  ikke, og en ny fil opprettes bare dersom den ikke allerede finnes.
- En ny test gjenskaper den konkrete 400-feilen og kontrollerer at frontenden
  ikke prøver en usikker reserveopplasting.
- Service-worker-cachen er økt slik at mobil og PC henter rettelsen.

## Nytt i 2.3.0

- **Prioriter vakt i valgte uker:** marker dato(er), huk av for de berørte ukene
  og trykk **Publiser ukevalg**. Funksjonen er av som standard. Lørdag prioriteres
  foran torsdag, deretter man/tir/ons. Vanlige kriterier gjelder fortsatt.
- Et lite gyllent merke viser aktive uker uten å endre kriteriefarge eller
  mørkeblått vaktomriss. Årsskifter håndteres med mandagsdato, ikke bare ukenummer.
- **Enkel vaktlogg · siste 48 timer** ligger rett under kilde-/synkstatusen.
  Hentes sammen med kalenderen eller med **Oppdater logg**. Viser match/nonmatch,
  overtakelsesresultat og eventuelt annonseringsresultat, uten prosessloggen.
- Rapporter om samme e-post samles til én hendelse. Én vellykket overtakelse
  vises som suksess selv om andre agenter rapporterer feil.
- Utløpte logglinjer skjules etter 48 timer. Gyldige utløpte loggfiler ryddes ved
  henting, med versjonskontroll; ukjente filer røres ikke. Agentene vil også rydde.
  Når alle programmer er avsluttet, venter fysisk rydding til neste kjøring.
- Ukevalg og kalender publiseres separat for tydelig lagringsstatus. Begge hentes
  med **Hent siste kalender**. Upubliserte valg varsles før henting/frakobling.
- Ny service-worker-cacheversjon inkluderer alle nye moduler.

**Viktig:** Denne utgivelsen inneholder bare frontend. Agent v112.1 implementerer
ukeprioriteringen og enkel vaktlogg. Oppdater alle kjørende agenter før
ukeprioriteringen brukes. Frontenden tar eller annonserer ingen vakter.

Ny vakt skal tas først. Bare bekreftet overtakelse tillater annonsering av én
lavere prioritert vakt fra samme uke. Feil ved annonsering skal ikke rulle tilbake
den nye vakten. «Markert ledig» betyr annonsert, ikke at noen andre har overtatt.

Agentkontrakt og eksempeldata:
[docs/weekly-upgrade-and-log-protocol.md](docs/weekly-upgrade-and-log-protocol.md).

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

**Agentstøtte:** v111.2 støtter Mine vakter. v110 og eldre støtter ikke
`owned_shifts_v1` og trenger oppdatering for denne hentingen. Vanlig kalender
og agentkontroll fungerer fortsatt. Ingen nye Azure-tillatelser etterspørres.

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
