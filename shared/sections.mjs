// Les trois sections, partagées par l'ingestion et par le site.
//
// Un seul endroit : l'ingestion recale un brief dont une section manque, et le
// site construit une page par section. Deux listes qui divergeraient donneraient
// une page vide sans que rien n'échoue.

export const SECTIONS = ['tourisme', 'coree', 'tech'];

export const SECTION_LABELS = {
  tourisme: 'Tourisme en Corée',
  coree: 'Actualités coréennes',
  tech: 'Tech et IA',
};
