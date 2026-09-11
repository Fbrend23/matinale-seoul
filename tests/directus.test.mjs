// Le client CMS et l'écriture du brief : deux surfaces, deux façons de mentir.
//
// La première est le RÉSEAU. Ce qui se teste n'est pas Directus, c'est la
// conduite du client quand la connexion n'aboutit PAS : ce qu'il rejoue, ce
// qu'il refuse de rejouer, et ce qu'il finit par dire.
//
// La seconde est la CHARGE écrite, et elle ne se voit pas en la relisant. La
// chaîne n'a pas le droit d'effacer : pour les items, c'est visible, saveBrief
// les archive ; pour la météo, tout tient à une clé qui NE PART PAS, et une clé
// absente ne se remarque dans aucune relecture.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createClient, saveBrief } from '../scripts/lib/directus.mjs';

// --- Le client : ce qui se rejoue, et ce qui ne se rejoue pas ----------------

/** L'échec que jette undici quand la connexion ne s'établit pas. */
const panneRéseau = (code) => new TypeError('fetch failed', { cause: { code } });

const réponse = (data) => ({
  status: 200,
  ok: true,
  headers: new Headers(),
  json: async () => ({ data }),
});

/** Un client dont on pilote les réponses, et qui n'attend jamais vraiment. */
function clientAvec(réponses) {
  const appels = [];
  const fetcher = async (url, options) => {
    appels.push({ url, method: options.method });
    const suite = réponses.shift();
    if (suite instanceof Error) throw suite;
    return suite;
  };
  const client = createClient({
    url: 'https://cms.test',
    token: 'jeton',
    fetcher,
    dormir: async () => {},
  });
  return { client, appels };
}

test('une lecture rejoue une connexion qui ne s’établit pas, puis aboutit', async () => {
  const { client, appels } = clientAvec([
    panneRéseau('ECONNREFUSED'),
    panneRéseau('ECONNREFUSED'),
    réponse([{ id: 7 }]),
  ]);

  assert.deepEqual(await client.get('/items/mat_briefs'), [{ id: 7 }]);
  assert.equal(appels.length, 3, 'deux reprises avant la bonne');
});

test('une lecture abandonne après quatre tentatives, en nommant la panne', async () => {
  const { client, appels } = clientAvec(Array(9).fill(panneRéseau('ENOTFOUND')));

  await assert.rejects(
    () => client.get('/items/mat_briefs'),
    (e) => {
      // Le message doit porter la CAUSE : « fetch failed » seul a déjà coûté
      // une enquête, le 10 septembre 2026.
      assert.match(e.message, /ENOTFOUND/);
      assert.match(e.message, /GET \/items\/mat_briefs/);
      return true;
    }
  );
  assert.equal(appels.length, 4, 'une tentative plus trois reprises');
});

test("une écriture n'est JAMAIS rejouée : un POST reçu sans réponse ferait un doublon", async () => {
  const { client, appels } = clientAvec([panneRéseau('ECONNRESET'), réponse({ id: 1 })]);

  await assert.rejects(() => client.post('/items/mat_news_items', { headline: 'x' }));
  assert.equal(appels.length, 1, 'aucune reprise sur une écriture');
});

test('un 429 est respecté, et il est compté séparément du réseau', async () => {
  const limite = {
    status: 429,
    ok: false,
    headers: new Headers({ 'retry-after': '1' }),
    json: async () => ({}),
  };
  const { client, appels } = clientAvec([limite, limite, réponse([])]);

  assert.deepEqual(await client.get('/items/mat_briefs'), []);
  assert.equal(appels.length, 3);
});

test("une erreur HTTP n'est pas une panne réseau : elle remonte telle quelle", async () => {
  const { client, appels } = clientAvec([
    {
      status: 403,
      ok: false,
      headers: new Headers(),
      json: async () => ({ errors: [{ message: 'Jeton sans droit d’écriture' }] }),
    },
  ]);

  await assert.rejects(() => client.get('/items/mat_briefs'), /403 Jeton sans droit/);
  assert.equal(appels.length, 1, 'un 403 ne se rejoue pas : il ne passera pas mieux');
});

// --- L'écriture du brief : ce qui ne s'efface pas ---------------------------

const brief = {
  date: '2026-09-10',
  title: 'Titre',
  standfirst: 'Chapeau',
  sections: [],
};

const bulletin = { date: '2026-09-10', tmin: 15, tmax: 22, code: 3, source: 'open-meteo' };

/**
 * Client factice : enregistre les charges au lieu de les envoyer.
 *
 * `refuseWeather` imite une instance où le champ n'est pas encore provisionné —
 * Directus y refuse la charge entière, pas seulement le champ inconnu.
 */
function faux({ existant = null, refuseWeather = false } = {}) {
  const patchs = [];
  const posts = [];

  const client = {
    get: async (chemin) => (chemin.includes('mat_briefs?filter') && existant ? [existant] : []),
    post: async (chemin, corps) => {
      if (refuseWeather && corps.weather) throw new Error('Invalid field "weather"');
      posts.push({ chemin, corps: structuredClone(corps) });
      return { id: 7 };
    },
    patch: async (chemin, corps) => {
      if (refuseWeather && corps.weather) throw new Error('Invalid field "weather"');
      patchs.push({ chemin, corps: structuredClone(corps) });
      return null;
    },
  };

  return { client, patchs, posts };
}

const charge = ({ patchs, posts }) => (patchs[0] ?? posts[0]).corps;

test('un bulletin fourni est écrit avec le brief', async () => {
  const faux1 = faux();
  await saveBrief(faux1.client, {
    brief,
    items: [],
    status: 'published',
    ingestStatus: 'ok',
    weather: bulletin,
  });

  assert.deepEqual(charge(faux1).weather, bulletin);
});

test("un bulletin absent n'efface pas celui d'un passage précédent", async () => {
  // Le cas concret : un brief publié ce matin AVEC sa météo, rejoué ce soir
  // alors qu'Open-Meteo ne répond plus. La clé doit rester hors de la charge —
  // « weather: null » remplacerait le bulletin du matin par du vide.
  const faux1 = faux({ existant: { id: 7, status: 'published' } });
  await saveBrief(faux1.client, {
    brief,
    items: [],
    status: 'published',
    ingestStatus: 'ok',
    weather: null,
  });

  assert.equal(faux1.patchs.length, 1);
  assert.ok(
    !('weather' in faux1.patchs[0].corps),
    'la clé weather ne doit pas figurer dans la charge quand il n’y a pas de relevé'
  );
});

test('la trace d’un brief recalé ne touche pas au bulletin', async () => {
  // Ce chemin-là ne passe pas de `weather` du tout : même exigence.
  const faux1 = faux({ existant: { id: 7, status: 'published' } });
  await saveBrief(faux1.client, {
    brief,
    items: [],
    status: 'draft',
    ingestStatus: 'failed',
    failureReason: 'cohérence : daté d’hier',
  });

  assert.ok(!('weather' in faux1.patchs[0].corps));
});

test('un champ weather absent du CMS ne fait pas perdre le brief', async () => {
  // Provisionnement en retard : Directus refuse la charge ENTIÈRE. Le brief
  // doit passer quand même, sans son bloc. « La météo ne recale jamais un
  // brief » vaut à l'écriture comme ailleurs.
  const faux1 = faux({ refuseWeather: true });
  const id = await saveBrief(faux1.client, {
    brief,
    items: [],
    status: 'published',
    ingestStatus: 'ok',
    weather: bulletin,
  });

  assert.equal(id, 7);
  assert.equal(faux1.posts.length, 1);
  assert.ok(!('weather' in faux1.posts[0].corps));
});

test('une panne étrangère à la météo remonte telle quelle', async () => {
  // Le repli ne doit pas devenir un avaleur d'erreurs : sans météo dans la
  // charge, un refus est un vrai refus.
  const client = {
    get: async () => [],
    post: async () => {
      throw new Error('401 jeton refusé');
    },
    patch: async () => null,
  };

  await assert.rejects(
    saveBrief(client, { brief, items: [], status: 'published', ingestStatus: 'ok' }),
    /401/
  );
});

test('une panne réseau ne rejoue pas l’écriture, même avec une météo', async () => {
  // La règle du client vaut ici aussi : un POST reçu dont la réponse s'est
  // perdue créerait un brief en double. Le filet météo ne doit pas la défaire —
  // il ne rattrape qu'un REFUS de Directus, qui n'a pas de `cause`.
  let appels = 0;
  const client = {
    get: async () => [],
    post: async () => {
      appels += 1;
      throw new Error('POST /items/mat_briefs → fetch failed (ECONNREFUSED)', {
        cause: new TypeError('fetch failed'),
      });
    },
    patch: async () => null,
  };

  await assert.rejects(
    saveBrief(client, {
      brief,
      items: [],
      status: 'published',
      ingestStatus: 'ok',
      weather: bulletin,
    }),
    /ECONNREFUSED/
  );
  assert.equal(appels, 1, 'une seule tentative : aucune écriture rejouée');
});

test('le brief de l’agent n’est jamais muté', async () => {
  // La météo transite par un paramètre distinct : c'est ce qui la tient hors du
  // contrat de l'agent et hors du fichier archivé dans archive/.
  const faux1 = faux();
  await saveBrief(faux1.client, {
    brief,
    items: [],
    status: 'published',
    ingestStatus: 'ok',
    weather: bulletin,
  });

  assert.ok(!('weather' in brief));
});

// --- L'écriture des items ----------------------------------------------------
//
// Jusqu'ici, tous les tests de saveBrief passaient « items: [] » : la seule
// partie qui écrit réellement le contenu du brief n'était pas couverte.

const unItem = (n) => ({
  section: 'tech',
  headline: `Titre ${n}`,
  summary: 'Résumé.',
  importance: n,
  source_name: 'Source',
  source_url: `https://exemple.test/${n}`,
});

test('les items partent en UN seul POST, pas un par item', async () => {
  const faux1 = faux();
  await saveBrief(faux1.client, {
    brief,
    items: [unItem(1), unItem(2), unItem(3)],
    status: 'published',
    ingestStatus: 'ok',
  });

  const écritures = faux1.posts.filter((p) => p.chemin.includes('mat_news_items'));
  assert.equal(écritures.length, 1, 'une instance à 384 Mo ne mérite pas trois allers-retours');
  assert.equal(écritures[0].corps.length, 3);
});

test('le rang des items est celui du brief, et il est conservé', async () => {
  const faux1 = faux();
  await saveBrief(faux1.client, {
    brief,
    items: [unItem(1), unItem(2), unItem(3)],
    status: 'published',
    ingestStatus: 'ok',
  });

  const envoyés = faux1.posts.find((p) => p.chemin.includes('mat_news_items')).corps;
  assert.deepEqual(
    envoyés.map((i) => i.sort),
    [1, 2, 3]
  );
  assert.deepEqual(
    envoyés.map((i) => i.headline),
    ['Titre 1', 'Titre 2', 'Titre 3']
  );
});

test('un item sans date de vérification part quand même, la clé à null', async () => {
  // Le cas de l'accès refusé : la garde 2 conserve l'item sans pouvoir dater
  // quoi que ce soit. Écrire une date inventée serait pire que ne rien écrire.
  const faux1 = faux();
  await saveBrief(faux1.client, {
    brief,
    items: [unItem(1)],
    status: 'published',
    ingestStatus: 'ok',
  });

  const envoyés = faux1.posts.find((p) => p.chemin.includes('mat_news_items')).corps;
  assert.equal(envoyés[0].link_checked_at, null);
});

test("aucun item n'écrit aucun POST d'items", async () => {
  const faux1 = faux();
  await saveBrief(faux1.client, { brief, items: [], status: 'draft', ingestStatus: 'failed' });

  assert.equal(faux1.posts.filter((p) => p.chemin.includes('mat_news_items')).length, 0);
});
