// Les quatre sections, partagées par l'ingestion et par le site.
//
// Un seul endroit : l'ingestion recale un brief dont une section manque, et le
// site construit une page par section. Deux listes qui divergeraient donneraient
// une page vide sans que rien n'échoue.

// L'ordre est celui de lecture du brief, sur le site comme dans le fichier.
export const SECTIONS = ['tourisme', 'coree', 'tech', 'gaming'];

// Clés en anglais, libellés en français : même partage que dans le contrat de
// sortie, où les noms de champs sont anglais et la prose française.
export const SECTION_LABELS = {
  tourisme: 'Tourisme en Corée',
  coree: 'Actualités coréennes',
  tech: 'Tech et IA',
  gaming: 'Jeux vidéo',
};
