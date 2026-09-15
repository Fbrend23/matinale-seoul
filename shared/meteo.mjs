// Les temps qu'il fait, dits en français.
//
// Partagé par l'ingestion et par le site, comme sections.mjs et pour la même
// raison : deux tables qui divergeraient donneraient un libellé faux sans que
// rien n'échoue.
//
// Ce qui est STOCKÉ dans le brief est le code WMO, pas son libellé. Une
// formulation figée dans chaque brief archivé ne se corrigerait plus ; dérivée
// au rendu, elle se corrige une fois et vaut pour toute l'archive.

// Codes WMO tels qu'Open-Meteo les renvoie dans `weather_code`.
export const CIEL = {
  0: 'Ciel dégagé',
  1: 'Plutôt dégagé',
  2: 'Partiellement nuageux',
  3: 'Couvert',
  45: 'Brouillard',
  48: 'Brouillard givrant',
  51: 'Bruine faible',
  53: 'Bruine',
  55: 'Bruine forte',
  56: 'Bruine verglaçante',
  57: 'Bruine verglaçante forte',
  61: 'Pluie faible',
  63: 'Pluie',
  65: 'Pluie forte',
  66: 'Pluie verglaçante',
  67: 'Pluie verglaçante forte',
  71: 'Neige faible',
  73: 'Neige',
  75: 'Neige forte',
  77: 'Grains de neige',
  80: 'Averses faibles',
  81: 'Averses',
  82: 'Averses violentes',
  85: 'Averses de neige faibles',
  86: 'Averses de neige',
  95: 'Orage',
  96: 'Orage et grêle',
  99: 'Orage et forte grêle',
};

/**
 * Le libellé d'un code WMO.
 *
 * Le repli n'est pas de la coquetterie : l'OMM ajoute des codes, et un
 * `undefined` rendu tel quel écrirait « undefined » en tête du brief du jour,
 * sans que rien n'ait échoué nulle part.
 */
export function libelléCiel(code) {
  return CIEL[code] ?? 'Temps indéterminé';
}

// --- La qualité de l'air --------------------------------------------------------
//
// Les seuils d'AirKorea sur les PM2,5 en moyenne journalière, µg/m³ : 좋음
// jusqu'à 15, 보통 jusqu'à 35, 나쁨 jusqu'à 75, 매우나쁨 au-delà. Ce sont ceux
// que les Séoulites lisent sur leur téléphone chaque matin, et la Matinale
// parle de Séoul. Comme le libellé du ciel, la grille vit ici et se déduit au
// rendu : ce qui est stocké est la mesure, et une grille corrigée vaut pour
// toute l'archive.

export const SEUILS_PM25 = [
  { max: 15, clé: 'bon', libellé: 'Bon' },
  { max: 35, clé: 'moyen', libellé: 'Moyen' },
  { max: 75, clé: 'mauvais', libellé: 'Mauvais' },
  { max: Infinity, clé: 'tres-mauvais', libellé: 'Très mauvais' },
];

/**
 * Le grade d'une mesure de PM2,5.
 *
 * Même repli que le ciel : un non-nombre rend un grade nommé plutôt qu'un
 * `undefined` en tête de brief.
 *
 * @param {unknown} pm25
 * @returns {{clé: string, libellé: string}}
 */
export function gradeAir(pm25) {
  if (typeof pm25 !== 'number' || !Number.isFinite(pm25)) {
    return { clé: 'inconnu', libellé: 'Air indéterminé' };
  }
  const grade = SEUILS_PM25.find((s) => pm25 <= s.max);
  return { clé: grade.clé, libellé: grade.libellé };
}
