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

import {
  createClient,
  saveBrief,
  activeEvents,
  saveEvents,
  archiveExpiredEvents,
  updateEventDates,
} from '../scripts/lib/directus.mjs';

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
function faux({ existant = null, refuseWeather = false, refuse = [] } = {}) {
  const patchs = [];
  const posts = [];

  // Une instance qui ne connaît pas encore un champ refuse la charge ENTIÈRE,
  // en le nommant. C'est ce nom qui permet de ne sacrifier que lui.
  const inconnus = [...refuse, ...(refuseWeather ? ['weather'] : [])];
  const refuser = (corps) => {
    const fautif = inconnus.find((clé) => clé in corps);
    if (fautif) throw new Error(`Invalid field "${fautif}" in payload`);
  };

  const client = {
    get: async (chemin) => (chemin.includes('mat_briefs?filter') && existant ? [existant] : []),
    post: async (chemin, corps) => {
      if (!Array.isArray(corps)) refuser(corps);
      posts.push({ chemin, corps: structuredClone(corps) });
      return { id: 7 };
    },
    patch: async (chemin, corps) => {
      refuser(corps);
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

// --- Les rubriques vides, et leur phrase -------------------------------------

const notes = { tech: 'Journée creuse côté technologie.' };

test('les notes de rubrique vide sont écrites avec le brief', async () => {
  const faux1 = faux();
  await saveBrief(faux1.client, {
    brief,
    items: [],
    status: 'published',
    ingestStatus: 'ok',
    emptyNotes: notes,
  });

  assert.deepEqual(charge(faux1).empty_notes, notes);
});

test("des notes absentes n'effacent pas celles d'un passage précédent", async () => {
  // Même raison que pour la météo : un brief recalé, écrit en simple trace, ne
  // doit pas emporter ce que le passage du matin avait dit.
  const faux1 = faux({ existant: { id: 7, status: 'published' } });
  await saveBrief(faux1.client, {
    brief,
    items: [],
    status: 'draft',
    ingestStatus: 'failed',
    emptyNotes: null,
  });

  assert.ok(!('empty_notes' in faux1.patchs[0].corps), 'la clé doit rester hors de la charge');
});

test('une instance sans le champ garde le brief, et le reste avec', async () => {
  // Le piège : retirer les accessoires dans un ordre fixe sacrifierait le
  // bulletin météo alors que l'instance ne bute que sur « empty_notes ».
  const faux1 = faux({ refuse: ['empty_notes'] });
  await saveBrief(faux1.client, {
    brief,
    items: [],
    status: 'published',
    ingestStatus: 'ok',
    weather: bulletin,
    emptyNotes: notes,
  });

  const écrite = charge(faux1);
  assert.ok(!('empty_notes' in écrite), 'le champ refusé doit partir');
  assert.deepEqual(écrite.weather, bulletin, 'le bulletin, lui, n avait rien à se reprocher');
  assert.equal(écrite.title, brief.title, 'et le brief est bien écrit');
});

// --- Les événements : même doctrine, autre collection -----------------------
//
// Archiver, jamais effacer ; un seul POST ; et au rejeu, ne pas se reconnaître
// soi-même. Ce dernier point tient à un filtre côté client, et c'est le seul
// qu'une relecture de la requête ne montre pas.

/** Client factice pour mat_events : rend ce qu'on lui donne, note ce qu'on écrit. */
function fauxÉvénements({ actifs = [], anciens = [], finis = [] } = {}) {
  const patchs = [];
  const posts = [];

  const client = {
    get: async (chemin) => {
      if (chemin.includes('fields=id,name,start_date')) return actifs;
      if (chemin.includes('fields=id,name,end_date')) return finis;
      if (chemin.includes('filter[brief][_eq]')) return anciens;
      return [];
    },
    post: async (chemin, corps) => {
      posts.push({ chemin, corps: structuredClone(corps) });
      return corps.map((_, i) => ({ id: 100 + i }));
    },
    patch: async (chemin, corps) => {
      patchs.push({ chemin, corps: structuredClone(corps) });
      return null;
    },
  };

  return { client, patchs, posts };
}

const événement = {
  name: 'Pop-up Pokémon Center',
  kind: 'popup',
  theme: 'pokemon',
  venue: 'Pokémon Center Seoul',
  area: 'Seongsu',
  start_date: '2026-09-01',
  end_date: '2026-10-12',
  summary: 'Boutique éphémère.',
  source_name: 'Visit Seoul',
  source_url: 'https://english.visitseoul.net/pop-up',
  link_checked_at: '2026-09-04T22:00:00.000Z',
};

test('les événements partent en un seul POST, rattachés au brief', async () => {
  const f = fauxÉvénements();
  const n = await saveEvents(f.client, { events: [événement, { ...événement, name: 'Autre' }], briefId: 7 });

  assert.equal(n, 2);
  assert.equal(f.posts.length, 1, 'un seul aller-retour');
  assert.equal(f.posts[0].corps.length, 2);
  assert.equal(f.posts[0].corps[0].brief, 7);
  assert.equal(f.posts[0].corps[0].status, 'published');
  assert.deepEqual(f.posts[0].corps.map((e) => e.sort), [1, 2]);
  // Les champs facultatifs absents partent à null, pas absents : la charge
  // dit exactement ce qu'on sait.
  assert.equal(f.posts[0].corps[0].map_url, null);
  assert.equal(f.posts[0].corps[0].booking_url, null);
});

test('sans événement à écrire, rien n est POSTé', async () => {
  const f = fauxÉvénements();
  assert.equal(await saveEvents(f.client, { events: [], briefId: 7 }), 0);
  assert.equal(f.posts.length, 0);
});

test('un rejeu archive les événements du passage précédent, ceux de CE brief seulement', async () => {
  const f = fauxÉvénements({ anciens: [{ id: 3 }, { id: 4 }] });
  await saveEvents(f.client, { events: [événement], briefId: 7 });

  assert.deepEqual(
    f.patchs.map((p) => [p.chemin, p.corps.status]),
    [
      ['/items/mat_events/3', 'archived'],
      ['/items/mat_events/4', 'archived'],
    ]
  );
  assert.equal(f.posts.length, 1, 'puis il réécrit');
});

test('les événements actifs excluent ceux du brief rejoué, sans perdre ceux sans brief', async () => {
  const f = fauxÉvénements({
    actifs: [
      { id: 1, name: 'du brief rejoué', brief: 7 },
      { id: 2, name: 'd un autre brief', brief: 2 },
      { id: 3, name: 'orphelin', brief: null },
    ],
  });

  const connus = await activeEvents(f.client, { today: '2026-09-04', saufBrief: 7 });
  assert.deepEqual(connus.map((e) => e.name), ['d un autre brief', 'orphelin']);

  const tous = await activeEvents(f.client, { today: '2026-09-04' });
  assert.equal(tous.length, 3);
});

test('l archivage ne touche qu à ce qui est fini, et le rend', async () => {
  const f = fauxÉvénements({ finis: [{ id: 9, name: 'Fini', end_date: '2026-09-01' }] });
  const archivés = await archiveExpiredEvents(f.client, { today: '2026-09-04' });

  assert.deepEqual(archivés.map((a) => a.id), [9]);
  assert.deepEqual(f.patchs, [{ chemin: '/items/mat_events/9', corps: { status: 'archived' } }]);
});

test('rien de fini, rien d archivé', async () => {
  const f = fauxÉvénements();
  assert.deepEqual(await archiveExpiredEvents(f.client, { today: '2026-09-04' }), []);
  assert.equal(f.patchs.length, 0);
});

test("un champ fx absent du CMS ne fait pas perdre le brief, ni sa météo", async () => {
  // Même filet que pour weather : Directus nomme le champ qu'il refuse, et
  // seul celui-là est sacrifié.
  const f = faux({ refuse: ['fx'] });
  const cours = { date: '2026-09-10', rate_date: '2026-09-10', base: 'CHF', quote: 'KRW', rate: 1646.98 };
  await saveBrief(f.client, {
    brief,
    items: [],
    status: 'published',
    ingestStatus: 'ok',
    weather: bulletin,
    fx: cours,
  });

  assert.equal(f.posts.length, 1);
  assert.ok(!('fx' in f.posts[0].corps));
  assert.deepEqual(f.posts[0].corps.weather, bulletin, 'la météo ne paie pas pour le change');
});

test('une mise à jour de dates ne touche qu aux dates et à la source qui les annonce', async () => {
  const f = fauxÉvénements();
  await updateEventDates(f.client, 3, { ...événement, end_date: '2026-11-01' });

  assert.equal(f.patchs.length, 1);
  assert.equal(f.patchs[0].chemin, '/items/mat_events/3');
  assert.deepEqual(Object.keys(f.patchs[0].corps).sort(), ['end_date', 'link_checked_at', 'source_lang', 'source_name', 'source_url', 'start_date']);
  assert.equal(f.patchs[0].corps.end_date, '2026-11-01');
});
