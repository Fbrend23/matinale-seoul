// Le bulletin météo du brief, relevé auprès d'Open-Meteo.
//
// Seule pièce de la chaîne dont la panne ne doit RIEN arrêter. La météo est un
// accessoire du brief : elle ne retient jamais l'actualité. Le module se
// contente donc de lever, et c'est l'ingestion qui choisit d'en faire un
// silence, la décision d'ignorer un échec doit se lire là où le brief se
// publie, pas être enterrée ici.
//
// `fetcher` injectable et minuteur d'abandon, comme checkLinks : c'est ce qui
// rend le relevé testable sans réseau, donc réellement testé.
//
// Open-Meteo est gratuit et sans clé : aucun secret nouveau à déposer dans le
// dépôt. Ses données sont sous CC-BY 4.0, d'où l'attribution que le composant
// affiche, elle n'est pas décorative.

export const SEOUL = { latitude: 37.5665, longitude: 126.978 };

const BASE = 'https://api.open-meteo.com/v1/forecast';

// Séoul ne passe pas à l'heure d'été : ce décalage est constant. En recevoir un
// autre ne veut donc jamais dire « saison », cela veut dire que le paramètre
// « timezone » n'a pas été pris en compte, et c'est le piège de ce module.
// Sans lui, l'API répond avec LA BONNE DATE mais des min/max agrégés sur une
// journée UTC, décalée de neuf heures. Contrôler la date seule laisserait donc
// passer un bulletin faux qui a toutes les apparences du bon.
const DÉCALAGE_SEOUL = 32_400;

const CHAMPS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
];

/**
 * L'adresse du relevé, pour un jour donné.
 *
 * Exportée pour être testée : c'est ici que se joue l'étanchéité au fuseau, et
 * une URL se vérifie sans réseau.
 */
export function urlRelevé(date) {
  const params = new URLSearchParams({
    latitude: String(SEOUL.latitude),
    longitude: String(SEOUL.longitude),
    daily: CHAMPS.join(','),
    // Les deux paramètres de fuseau ne font pas double emploi. `timezone` fait
    // agréger les valeurs journalières sur les journées de SÉOUL et non sur
    // celles d'UTC ; start_date et end_date désignent LE jour du brief plutôt
    // que le premier jour que l'API voudra bien servir. Le runner de CI vit en
    // UTC, à quinze heures de Séoul : sans les deux, le bulletin porterait
    // régulièrement sur le mauvais jour, et rien ne le dirait.
    timezone: 'Asia/Seoul',
    start_date: date,
    end_date: date,
  });
  return `${BASE}?${params}`;
}

const nombre = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Le bulletin de Séoul pour ce jour-là, ou une exception qui dit pourquoi non. */
// Plus court que les 10 s de checkLinks, et à dessein : un lien mort retire un
// item du brief, un relevé manquant ne retire qu'un encadré. Il ne reste qu'une
// quinzaine de minutes avant 8 h, heure de Séoul, on ne les dépense pas ici.
export async function relevéMétéo({ date }, { fetcher = fetch, timeoutMs = 5_000 } = {}) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetcher(urlRelevé(date), { signal: controller.signal });
  } catch (e) {
    throw new Error(
      e.name === 'AbortError' ? `pas de réponse en ${timeoutMs / 1000} s` : e.message
    );
  } finally {
    clearTimeout(minuteur);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json().catch(() => null);
  const jour = json?.daily;

  // Un bulletin daté d'un autre jour est pire que pas de bulletin : il serait
  // faux sans en avoir l'air, et l'archive le garderait tel quel.
  if (!jour || jour.time?.[0] !== date) {
    throw new Error(`relevé daté du ${jour?.time?.[0] ?? '(rien)'}, attendu le ${date}`);
  }

  // Voir DÉCALAGE_SEOUL : la date ci-dessus ne suffit pas à prouver que la
  // journée a été découpée sur Séoul.
  if (json.utc_offset_seconds !== DÉCALAGE_SEOUL) {
    throw new Error(`journée calculée sur ${json.timezone ?? '?'}, pas sur Séoul`);
  }

  const tmin = nombre(jour.temperature_2m_min?.[0]);
  const tmax = nombre(jour.temperature_2m_max?.[0]);
  const code = nombre(jour.weather_code?.[0]);

  // Sans températures ni code, il ne resterait qu'un bloc à trous : mieux vaut
  // pas de bloc du tout.
  if (tmin === null || tmax === null || code === null) {
    throw new Error('relevé incomplet : ni températures ni code exploitables');
  }

  return {
    date,
    tmin: Math.round(tmin),
    tmax: Math.round(tmax),
    code,
    // Hors fenêtre de prévision, un rejeu tardif, Open-Meteo laisse la
    // probabilité vide. Ce n'est pas un échec : la ligne disparaît, le
    // bulletin reste.
    precip_probability: nombre(jour.precipitation_probability_max?.[0]),
    precip_mm: nombre(jour.precipitation_sum?.[0]),
    fetched_at: new Date().toISOString(),
    source: 'open-meteo',
  };
}

// --- La qualité de l'air --------------------------------------------------------
//
// Même fournisseur, même licence, même attribution, autre service : Open-Meteo
// sert les particules fines sur une seconde adresse. Un second relevé, à part
// du premier, et pour une raison : l'air peut manquer sans que la météo
// manque, et c'est l'ingestion qui les assemble.
//
// LA MOYENNE DU JOUR, pas le pic. Les seuils d'AirKorea, ceux que le lecteur
// connaît, qualifient une moyenne sur vingt-quatre heures, et un pic à quatre
// heures du matin ferait crier « mauvais » sur une journée « moyenne ». Le
// brief part vers 7 h 45 : la journée est une prévision, et le composant
// le dit.

const BASE_AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const CHAMPS_AIR = ['pm2_5', 'pm10'];

/** En dessous, la journée est trop creuse pour une moyenne honnête. */
const HEURES_MINIMUM = 12;

/** L'adresse du relevé d'air, pour un jour donné. Exportée pour être testée. */
export function urlRelevéAir(date) {
  const params = new URLSearchParams({
    latitude: String(SEOUL.latitude),
    longitude: String(SEOUL.longitude),
    hourly: CHAMPS_AIR.join(','),
    // Les mêmes deux paramètres de fuseau que le bulletin, et pour la même
    // raison : sans `timezone`, les vingt-quatre heures seraient celles d'UTC.
    timezone: 'Asia/Seoul',
    start_date: date,
    end_date: date,
  });
  return `${BASE_AIR}?${params}`;
}

/** La moyenne arrondie des heures renseignées, ou null s'il y en a trop peu. */
function moyenne(valeurs) {
  const nombres = (valeurs ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nombres.length < HEURES_MINIMUM) return null;
  return Math.round(nombres.reduce((a, b) => a + b, 0) / nombres.length);
}

/**
 * Les particules fines de Séoul pour ce jour-là, ou une exception qui dit
 * pourquoi non.
 *
 * @returns {Promise<{pm25: number, pm10: number|null, air_fetched_at: string}>}
 */
export async function relevéAir({ date }, { fetcher = fetch, timeoutMs = 5_000 } = {}) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetcher(urlRelevéAir(date), { signal: controller.signal });
  } catch (e) {
    throw new Error(
      e.name === 'AbortError' ? `pas de réponse en ${timeoutMs / 1000} s` : e.message
    );
  } finally {
    clearTimeout(minuteur);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json().catch(() => null);
  const heures = json?.hourly;

  // Les mêmes deux contrôles que le bulletin : le bon jour, découpé sur Séoul.
  const premier = heures?.time?.[0] ?? '';
  if (!premier.startsWith(date)) {
    throw new Error(`relevé d'air daté du ${premier || '(rien)'}, attendu le ${date}`);
  }
  if (json.utc_offset_seconds !== DÉCALAGE_SEOUL) {
    throw new Error(`journée calculée sur ${json.timezone ?? '?'}, pas sur Séoul`);
  }

  const pm25 = moyenne(heures.pm2_5);
  if (pm25 === null) {
    throw new Error(`relevé d'air trop creux : moins de ${HEURES_MINIMUM} heures de PM2,5`);
  }

  return {
    pm25,
    // Le PM10 est un complément : son absence ne retire pas la ligne.
    pm10: moyenne(heures.pm10),
    air_fetched_at: new Date().toISOString(),
  };
}
