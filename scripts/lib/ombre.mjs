// Le brief en ombre : Gemini rédige le même brief que la session Claude, le
// même matin, sur la même veille, et son rendu n'est pas publié. Il est passé
// au contrôle avant vol, déposé à côté de la veille, et comparé au brief du
// jour. Quelques matins de cela disent si Gemini peut prendre la rédaction,
// ce qui se mesure et ne se devine pas : le choix des items, le français des
// résumés, les sources réellement ouvertes, la durée.
//
// POURQUOI EN OMBRE ET PAS EN ESSAI. Un essai se fait un matin, à la main, et
// juge un brief ; l'ombre en juge dix, sur des journées creuses et des
// journées pleines, sans que personne ne se lève pour ça. Et elle ne coûte que
// du quota Google, dont la recherche ne prend qu'une part.
//
// LE SCRIPT ÉCRIT, PAS GEMINI. Comme pour la recherche : Gemini rend un
// objet JSON, c'est le script qui le dépose, lance le contrôle, et renvoie
// les fautes pour un tour de correction. Le jour où l'ombre remplacerait la
// session, c'est aussi le script qui commiterait : l'agent qui rédige n'a
// pas à tenir git.
//
// Le module ne lance rien : la commande vit dans scripts/ombre.mjs.

import { hostOf } from './guards.mjs';

/**
 * L'exemple de brief du prompt de la session, tel quel.
 *
 * Un seul exemple pour les deux rédactions : celui de
 * prompts/brief-quotidien.md, que les tests vérifient contre le schéma à
 * chaque exécution. Le recopier dans un second prompt, c'est deux exemples
 * qui divergent au premier champ ajouté.
 *
 * @param {string} promptMd   prompts/brief-quotidien.md
 * @returns {string}          le JSON, sans les clôtures
 */
export function exempleDuPrompt(promptMd) {
  const bloc = /```json\r?\n(\{[\s\S]*?\})\r?\n```/.exec(promptMd);
  if (!bloc) throw new Error('aucun exemple JSON dans le prompt de la session');
  return bloc[1];
}

/**
 * La consigne de l'ombre, remplie.
 *
 * @param {string} gabarit          prompts/brief-ombre.md
 * @param {object} p
 * @param {string} p.jour           AAAA-MM-JJ à Séoul
 * @param {string} p.veille         chemin de la veille, relatif au dépôt
 * @param {string[]} p.domaines     la presse : les rédactions, citables partout
 * @param {string[]} [p.officiels]  lieux, enseignes, labels : citables dans `events` seulement
 * @param {string} p.exemple        exempleDuPrompt()
 */
export function composerConsigneOmbre(gabarit, { jour, veille, domaines = [], officiels = [], exemple }) {
  return gabarit
    .replaceAll('{{JOUR}}', jour)
    .replaceAll('{{VEILLE}}', veille)
    .replaceAll('{{DOMAINES}}', domaines.join(', '))
    .replaceAll('{{OFFICIELS}}', officiels.join(', '))
    .replaceAll('{{EXEMPLE}}', exemple);
}

/**
 * La consigne du tour de correction : le brief tel qu'il est, le verdict du
 * contrôle, et la demande de rendre l'objet entier corrigé. L'objet entier,
 * pas un correctif : ce qui est rendu est ce qui est déposé, sans fusion à
 * deviner.
 *
 * @param {string} jour
 * @param {object} brief
 * @param {string} rapport     la sortie du contrôle avant vol
 */
export function consigneDeCorrection(jour, brief, rapport) {
  return [
    `Tu as rendu ce matin, ${jour} à Séoul, le brief de « La Matinale de Séoul » ci-dessous, et le contrôle avant vol l'a recalé. Voici son verdict, puis le brief.`,
    '',
    'Corrige ce que le contrôle nomme, et rien d\'autre : un lien mort, retire l\'item ; un résumé trop long, coupe ; une faute de schéma, corrige le champ. Ne rouvre aucune page, ne cherche rien.',
    '',
    '**Rends l\'objet JSON entier, corrigé, et rien d\'autre** : pas de phrase avant, pas de commentaire après, pas de clôture de code.',
    '',
    '## Verdict du contrôle',
    '',
    '```',
    rapport.trim(),
    '```',
    '',
    '## Le brief',
    '',
    JSON.stringify(brief, null, 2),
  ].join('\n');
}

/**
 * L'objet JSON dans ce que Gemini a répondu : entre le premier `{` et le
 * dernier `}`, comme extraireTableau() pour la recherche. Ce qui ne s'analyse
 * pas est une panne, pas un brief vide.
 *
 * @param {string} texte
 * @returns {object}
 */
export function extraireObjet(texte) {
  const début = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
  if (début < 0 || fin < début) throw new Error('aucun objet JSON dans la réponse');
  let objet;
  try {
    objet = JSON.parse(texte.slice(début, fin + 1));
  } catch (e) {
    throw new Error(`objet JSON illisible : ${e.message}`);
  }
  if (!objet || typeof objet !== 'object' || Array.isArray(objet)) throw new Error('la réponse n\'est pas un objet');
  return objet;
}

const mots = (texte) => String(texte ?? '').trim().split(/\s+/).filter(Boolean).length;

/**
 * Les deux briefs côte à côte, en Markdown, pour le matin où l'on décide.
 *
 * Pas de score : ce qui se compte est compté, sections, items, mots, sources,
 * événements, et ce qui se lit est mis côte à côte, les titres. Le reste, la
 * justesse d'un résumé, se juge en ouvrant les deux fichiers, et la
 * comparaison dit où ils sont.
 *
 * @param {object} p
 * @param {string} p.jour
 * @param {object} p.ombre            le brief de Gemini, tel que déposé
 * @param {object|null} p.référence   le brief de la session, s'il existe
 * @param {object} p.verdict          { passe: boolean, tours: number }, le contrôle avant vol de l'ombre
 * @param {object} [p.session]        { modèle, durée, tours, usage } de la session Gemini
 * @param {{ombre: string, référence?: string}} p.fichiers
 * @returns {string}
 */
export function comparer({ jour, ombre, référence, verdict, session = {}, fichiers }) {
  const lignes = [`# Ombre du ${jour}`, ''];
  lignes.push(
    `Gemini (${session.modèle ?? '?'}) : ${session.durée != null ? `${Math.round(session.durée)} s` : 'durée inconnue'}${session.tours ? `, ${session.tours} tours` : ''}${
      session.usage ? `, ${session.usage.input_tokens ?? '?'} tokens lus, ${session.usage.output_tokens ?? '?'} écrits` : ''
    }.`,
    `Contrôle avant vol : ${verdict.passe ? 'passe' : 'RECALÉ'} après ${verdict.tours} passage(s).`,
    `Fichiers : \`${fichiers.ombre}\`${fichiers.référence ? ` · \`${fichiers.référence}\`` : ' · pas de brief de session ce matin'}.`,
    ''
  );

  const sectionsDe = (brief) => Object.fromEntries((brief?.sections ?? []).map((s) => [s.key, s]));
  const sO = sectionsDe(ombre);
  const sR = sectionsDe(référence);
  const clés = [...new Set([...Object.keys(sO), ...Object.keys(sR)])];

  const résumé = (brief) => {
    const items = (brief?.sections ?? []).flatMap((s) => s.items ?? []);
    const hôtes = new Set(items.map((i) => hostOf(i.source_url)).filter(Boolean));
    const longueurs = items.map((i) => mots(i.summary));
    const moyenne = longueurs.length ? Math.round(longueurs.reduce((a, b) => a + b, 0) / longueurs.length) : 0;
    return { items: items.length, hôtes, moyenne, tropLongs: longueurs.filter((n) => n > 40).length, événements: (brief?.events ?? []).length };
  };
  const rO = résumé(ombre);
  const rR = résumé(référence);

  lignes.push('| | Ombre (Gemini) | Session |', '|---|---|---|');
  lignes.push(`| Items | ${rO.items} | ${référence ? rR.items : '—'} |`);
  lignes.push(`| Domaines sources | ${rO.hôtes.size} | ${référence ? rR.hôtes.size : '—'} |`);
  lignes.push(`| Mots par résumé (moy.) | ${rO.moyenne}${rO.tropLongs ? ` (${rO.tropLongs} > 40)` : ''} | ${référence ? `${rR.moyenne}${rR.tropLongs ? ` (${rR.tropLongs} > 40)` : ''}` : '—'} |`);
  lignes.push(`| Événements | ${rO.événements} | ${référence ? rR.événements : '—'} |`);
  lignes.push('');

  lignes.push(`**Titre** — ombre : ${ombre?.title ?? '—'}`);
  if (référence) lignes.push(`**Titre** — session : ${référence.title ?? '—'}`);
  lignes.push('');

  for (const clé of clés) {
    const o = sO[clé];
    const r = sR[clé];
    lignes.push(`## ${clé} · ombre ${o?.items?.length ?? 0}${référence ? ` · session ${r?.items?.length ?? 0}` : ''}`, '');
    if (o?.empty_note) lignes.push(`Ombre, section vide : ${o.empty_note}`, '');
    for (const item of o?.items ?? []) lignes.push(`- [ombre] ${item.headline} — ${hostOf(item.source_url) ?? item.source_url}`);
    if (référence) {
      if (r?.empty_note) lignes.push(`Session, section vide : ${r.empty_note}`);
      for (const item of r?.items ?? []) lignes.push(`- [session] ${item.headline} — ${hostOf(item.source_url) ?? item.source_url}`);
    }
    lignes.push('');
  }

  if (rO.événements || rR.événements) {
    lignes.push('## Événements', '');
    for (const e of ombre?.events ?? []) lignes.push(`- [ombre] ${e.name} · ${e.theme} · ${e.start_date} → ${e.end_date} · ${e.venue}`);
    for (const e of référence?.events ?? []) lignes.push(`- [session] ${e.name} · ${e.theme} · ${e.start_date} → ${e.end_date} · ${e.venue}`);
    lignes.push('');
  }

  const communs = [...rO.hôtes].filter((h) => rR.hôtes.has(h));
  if (référence) lignes.push(`Sources : ombre ${[...rO.hôtes].join(', ') || '—'} ; session ${[...rR.hôtes].join(', ') || '—'} ; en commun ${communs.join(', ') || 'aucune'}.`, '');

  return lignes.join('\n');
}
