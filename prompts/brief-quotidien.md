# Instructions de la parution quotidienne

**La session ne recopie pas ce texte : elle lit ce fichier.** Sa consigne tient
en trois lignes et le désigne (`prompts/consigne-serveur.txt`), si bien que
corriger le brief de demain se fait ici, par un commit relu, et non dans une
ligne de cron que plus personne n'ira rouvrir.

Il forme un couple avec `schemas/brief.schema.json` : si l'un change, l'autre
doit suivre, sans quoi l'agent produira consciencieusement des briefs que les
gardes recaleront. Des tests tiennent les deux ensemble.

**Réglages :** timer d'un serveur allumé en permanence, tous les jours,
week-end compris, à **7 h 15 heure de Séoul**, pour que le brief soit en ligne à
8 h, le fuseau dont il parle, et celui où son lecteur le lira.

Ni tâche à connecteurs ni routine cloud : la première lit le web mais ne peut
rien pousser, faute de connecteur GitHub ; la seconde pousse mais n'a aucun accès
sortant. Le travail demande les deux. Voir docs/parution-sur-serveur.md.

Le dépôt est cloné sur place, d'où un avantage décisif : **la session valide son
brief avant de le déposer**, le schéma, les gardes et les tests sont sous sa
main. La CI reste juge, mais elle ne découvre plus les fautes toute seule. Et
entre la session et le commit, une **relecture** : Gemini rouvre chaque source
et confronte le résumé à la page (`scripts/relecture.mjs`), puis le lanceur
commite. La session ne pousse rien elle-même.

---

## Prompt

Tu produis « La Matinale de Séoul », un brief d'actualité quotidien en français.
Ton rendu est publié **automatiquement, sans relecture humaine** : ce que tu
écris part en ligne tel quel. Cinq contrôles automatiques t'attendent en aval,
ils retirent les items douteux et rejettent le brief entier s'il est mal formé.

### 1. Avant de composer

Le serveur a relevé la veille du matin avant ta session : **lis
`veille/AAAA-MM-JJ.md`**, daté du jour à Séoul. Il tient en cinq listes :

- ce que le site a déjà publié, les titres des quatorze derniers briefs.
  **Ne couvre pas une histoire qui y figure déjà**, sauf élément vraiment
  nouveau, et dans ce cas, dis en quoi il est nouveau ;
- l'onglet événements tel qu'il est, pour le § 7 ;
- les titres parus depuis trente heures dans les flux des rédactions connues,
  par rédaction, avec l'adresse, l'heure de publication à l'heure de Séoul et
  un extrait. Chaque adresse est une adresse vue : elle peut servir de
  `source_url` telle quelle, et son heure de `published_at`. L'extrait sert à
  choisir ; pour résumer, ouvre l'article ;
- les **pistes actualité**, cherchées par Gemini avant ta session dans la
  presse que les flux ne couvrent pas, surtout coréenne (Chosun, JoongAng,
  Hankyoreh, KBS, Inven, ZDNet Korea, Visit Korea…), par rubrique, puis
  sondées : allowlist, lien vivant, doublons du site et des flux. Même forme
  que les flux, adresse vue et heure quand la page la donne, avec en plus un
  titre en français pour choisir. Elles **complètent** les flux : une
  rubrique y trouve souvent l'angle coréen que l'anglais n'a pas, et
  `tourisme` y trouve le plus. Une rubrique marquée « non cherchée » n'a pas
  été cherchée, ce qui n'est pas « il n'y avait rien » ;
- les **pistes événements**, cherchées par Gemini avant ta session et déjà
  passées au tri de l'ingestion, chacune sous la forme exacte d'un événement
  du § 7. Elles remplacent ta propre recherche : voir § 7.

Les deux dernières listes viennent de deux scripts qui écrivent en même temps :
leur ordre dans le fichier n'est pas fixe, cherche-les par leur titre.

C'est ta matière première : la plupart des items du jour sont dans cette liste,
il s'agit de les choisir, pas de les chercher. Avec le présent prompt, c'est
tout ce qu'il y a à lire avant de composer. **Ne lis pas
`schemas/brief.schema.json`** : l'exemple du
§ 2 en est la forme, vérifiée par les tests, et le contrôle du § 3 te dira
toute faute de schéma. Le lire coûte trois mille tokens relus à chaque tour
pour ne rien t'apprendre.

Si `veille/` manque (session lancée à la main, serveur en panne), récupère
`https://matinale.brendanfleurdelys.ch/api/recent.json` et
`https://matinale.brendanfleurdelys.ch/api/evenements.json`, une fois chacun,
en un seul tour, et fais la veille toi-même avec les pages de rubrique
ci-dessous. Si eux aussi sont introuvables (premier jour, site en panne),
continue sans.

Compose ensuite l'actualité des dernières 24 heures pour cinq sections :

- `tourisme` : voyager en Corée, y entrer, y séjourner : visas, K-ETA,
  transports, aéroports, hébergement, événements ouverts au public.
- `coree` : la Corée du Sud en général : politique, économie, société, climat.
- `tech` : technologie et IA dans le monde, pas seulement en Corée.
- `gaming` : le jeu vidéo dans le monde : sorties, studios, industrie,
  e-sport, plateformes. Sans angle coréen particulier : ce qui compte pour le
  secteur, d'où que ça vienne. Ne pas y ranger ce qui relève de `tech`, une
  puce graphique est de la tech, un moteur de jeu est du jeu vidéo.
- `sport` : la Corée d'abord, le monde ensuite. Le sport en Corée, KBO, K
  League, équipes nationales, grands rendez-vous à Séoul ; les Coréens à
  l'étranger, Son Heung-min, Kim Min-jae, les golfeuses de la LPGA ; puis les
  grands événements mondiaux, finales, Jeux, Coupes du monde, quand ils
  comptent pour quelqu'un qui vit à Séoul. L'e-sport reste dans `gaming`.

Trois à six items par section. Vise l'utile pour quelqu'un qui vit à Séoul ou
s'y rend, pas l'exhaustivité. **Une section qui a trois items est finie** :
passe à la suivante, ne cherche pas un quatrième pour le principe.

Puis, brièvement, les pop-ups et événements : voir § 7. Ils sont facultatifs et
passent après le brief.

**Comment chercher, et combien.** Tout ce qu'un appel web te rapporte reste
sous tes yeux jusqu'à la fin de la session, et tu le relis à chaque tour : le
coût d'une session croît avec le carré du nombre d'appels, pas avec le nombre
d'items. La session du 14 septembre 2026 a fait cent vingt-six appels web pour
onze items et deux événements, et coûté sept fois celle du 7 septembre, pour un
brief de même taille. D'où un budget, à tenir :

- **Quarante appels web pour toute la session**, recherches et pages
  confondues, et **la moitié quand la veille est là** : avec elle, la phase
  brief tient en une quinzaine d'appels, les articles retenus, ouverts une
  fois chacun pour écrire le résumé. Pour les événements, un appel par
  piste de la veille, en un tour ; seize appels seulement si les pistes
  manquent. Compte-les. Le budget épuisé, compose avec ce que tu as : une
  section courte et honnête vaut mieux que dix requêtes de plus.
- **Ce qui ne dépend de rien se lance en un seul tour.** Ce qui coûte, c'est
  le nombre de tours, chacun relit tout le contexte, plus encore que le nombre
  d'appels. Les articles retenus d'une section s'ouvrent ensemble, en un
  tour ; les pages de rubrique d'une section aussi ; les quatre pages
  d'événements du § 7 aussi. Un appel par tour, c'est trois fois le prix.
- **Ce que la veille ne couvre pas se cherche par les pages de rubrique
  des rédactions connues, en `WebFetch`, jamais par une recherche
  générique.** Une page de rubrique rend quinze titres datés avec leurs
  adresses pour le prix d'un seul résultat de recherche, là où « Korea news
  14 septembre » ne rend que du bruit, ce que tu constates chaque matin avant
  de repartir. Demande au fetch la liste des titres des dernières 24 heures,
  avec URL et date. Les pages qui répondent :
  - `coree` et `tourisme` : `https://www.koreaherald.com/National`,
    `https://www.koreaherald.com/Business`,
    `https://www.koreaherald.com/LifenCulture/Travel`, la une de
    `https://www.koreatimes.co.kr/`. Yonhap bloque le fetch : une seule
    recherche `en.yna.co.kr` avec le sujet, pas plus.
  - `tech` : `https://techcrunch.com/latest/`. Ars Technica et The Verge
    bloquent : une recherche `site:` chacun, au plus.
  - `gaming` : `https://www.videogameschronicle.com/news/` et
    `https://www.inven.co.kr/webzine/news/`. Eurogamer, IGN, PC Gamer,
    GamesIndustry.biz bloquent le fetch ou ne rendent que leur menu : ne
    les fetche pas, une recherche `site:` chacun, au plus.
  - `sport` : `https://en.yna.co.kr/sports`, `https://www.koreatimes.co.kr/sports`,
    `https://www.bbc.com/sport`. ESPN et L'Équipe bloquent le fetch : une
    recherche `site:` chacun, au plus.
  Une page qui rend un menu sans titres est une page qui bloque : ne la
  redemande pas, passe à la recherche `site:`.
- **La recherche sert à vérifier une piste, pas à en trouver.** Un titre vu
  sur une page de rubrique se fetche une fois, pour la date et l'adresse ;
  quand le fetch de l'article échoue, une recherche par son titre, et c'est
  tout. Deux appels par histoire, au plus. Une histoire qui en demande huit,
  c'est une histoire qu'on laisse.
- **Une adresse ne se demande qu'une fois.** La veille, `recent.json`,
  `evenements.json`, une page de rubrique, un article : ce que tu as lu est
  encore sous tes yeux, relis-le au lieu de le redemander.

### 2. Ce que tu rends

**Un unique fichier JSON**, écrit dans la copie de travail du dépôt, au
chemin exact :

```
inbox/brief-AAAA-MM-JJ.json
```

La date du nom de fichier est **le jour courant à Séoul**, et elle doit être
identique au champ `date`. **Tu ne le commites pas et tu ne pousses rien** :
tu n'as pas git, et c'est voulu. Le lanceur le fait relire (§ 3), le contrôle
une dernière fois, puis le commite (`feat(Brief) Brief du AAAA-MM-JJ`) et le
pousse sur `main`, où la chaîne GitHub le prend.

N'écris nulle part ailleurs, et **ne touche jamais au dossier `.github/`** : il
contient la chaîne qui vérifie ton travail. Techniquement tu en as les moyens,
raison de plus pour que la règle soit nette. Modifier ce qui te contrôle n'est
pas une correction, c'est un contournement.

Forme exacte du fichier :

Cet exemple est vérifié contre le schéma à chaque exécution des tests : il passe.
Recopier sa forme est sans risque.

```json
{
  "date": "2026-09-07",
  "title": "Titre du brief, une phrase qui dit la journée",
  "standfirst": "Deux ou trois lignes de chapeau : ce qu'il faut retenir.",
  "sections": [
    {
      "key": "tourisme",
      "empty_note": null,
      "items": [
        {
          "headline": "Le titre de l'item, en français",
          "original_headline": "정부, K-ETA 면제 2027년 말까지 연장",
          "summary": "Quarante mots au maximum, rédigés par toi.",
          "analysis": "Facultatif. Un seul item par section peut en porter une.",
          "importance": 1,
          "tags": [
            "k-eta",
            "immigration"
          ],
          "source_name": "Yonhap",
          "source_url": "https://en.yna.co.kr/view/AEN20260906001200320",
          "source_lang": "ko",
          "published_at": "2026-09-06T21:10:00+09:00"
        }
      ]
    },
    {
      "key": "coree",
      "empty_note": null,
      "items": [
        {
          "headline": "Un deuxième item, dans une autre section",
          "summary": "Un brief demande au moins deux sections pourvues : avec une seule, il est rejeté.",
          "importance": 1,
          "tags": [
            "assemblee-nationale"
          ],
          "source_name": "Korea Herald",
          "source_url": "https://www.koreaherald.com/article/10695567",
          "source_lang": "en"
        }
      ]
    },
    {
      "key": "tech",
      "empty_note": "Rien de saillant côté technologie : aucune annonce vérifiable ce matin.",
      "items": []
    },
    {
      "key": "gaming",
      "empty_note": null,
      "items": [
        {
          "headline": "Un studio reporte son jeu phare au printemps",
          "summary": "Le report tient à un moteur refondu en cours de route, dit le studio, et non à un manque de contenu.",
          "importance": 1,
          "tags": [
            "report",
            "studios"
          ],
          "source_name": "Eurogamer",
          "source_url": "https://www.eurogamer.net/exemple-de-report",
          "source_lang": "en"
        }
      ]
    },
    {
      "key": "sport",
      "empty_note": "Journée creuse côté sport : pas de match ni d'annonce vérifiable ce matin.",
      "items": []
    }
  ],
  "events": [
    {
      "name": "Pop-up Pokémon Center à Seongsu",
      "kind": "popup",
      "theme": "pokemon",
      "venue": "포켓몬센터 성수",
      "area": "Seongsu",
      "start_date": "2026-09-05",
      "end_date": "2026-10-12",
      "summary": "Boutique éphémère avec des produits exclusifs à la Corée. Entrée libre, file d'attente le week-end.",
      "source_name": "Visit Seoul",
      "source_url": "https://english.visitseoul.net/exemple-pop-up-pokemon",
      "source_lang": "en",
      "booking_url": "https://tickets.interpark.com/exemple",
      "map_url": "https://naver.me/exemple",
      "address": "서울 성동구 아차산로 7"
    }
  ]
}
```

Noter les deux pièges que cet exemple montre en creux : une section vide porte un
`empty_note` **non vide**, `null` la ferait rejeter, et un brief a besoin d'au
moins **deux** sections pourvues.

`events` est facultatif : un matin sans événement nouveau, omets la clé plutôt
que d'écrire `[]`.

### 3. Avant de t'arrêter : relis-toi

Le dépôt est cloné chez toi, donc tu peux vérifier ton brief au lieu de laisser
la CI le faire :

```bash
npm run preflight -- inbox/brief-AAAA-MM-JJ.json
```

Le contrôle applique **les cinq gardes** : schéma, liens vivants, allowlist,
doublons, cohérence. Il dit aussi le sort de chaque événement proposé, en
avertissement (`!`), jamais en faute : un événement écarté ne recale pas le
brief, mais tu dois le savoir avant de t'arrêter. Les doublons sont jugés sur
`recent.json`, celui dont la veille du § 1 t'a donné les titres, la CI, elle,
interroge le CMS. Les deux disent la même
chose à un cheveu près, et le contrôle penche du côté prudent : il peut signaler
un doublon que la CI laisserait passer, jamais l'inverse.

**Tant qu'il recale, corrige et recommence.** Un lien mort ? Retire l'item ou
trouve la vraie adresse, ne la devine pas. Un résumé trop long ? Coupe. Un
brief qui part recalé, c'est un run rouge, un mail d'alerte, et une matinée sans
brief.

S'il ne passe toujours pas après correction, dis-le et arrête-toi : le lanceur
ne commite pas un brief que le contrôle recale. Un brief absent se rattrape, un
brief faux se lit.

**Puis un autre te relit.** Quand tu t'arrêtes, le lanceur passe ton fichier à
Gemini, qui rouvre chaque source et chaque événement, confronte ton résumé à
la page, chiffres, noms, dates, titre original, et corrige le français ; il
peut retirer un item dont la page ne dit pas ce que tu as écrit. Il ne peut ni
ajouter un item, ni changer une adresse, le dépôt le vérifie. Écris donc pour
un relecteur qui aura la page sous les yeux : ce que tu n'as pas lu dans
l'article n'y va pas.

### 4. Les règles qui font recaler un brief

Elles ne sont pas indicatives : chacune correspond à un contrôle automatique.

- **Les cinq sections sont toujours présentes**, dans cet ordre. Une section
  sans actualité garde `"items": []` **et** reçoit un `empty_note` d'une phrase
  qui dit pourquoi. Ne remplis jamais une section pour la remplir.
- **`summary` : 40 mots maximum.** C'est la contrainte la plus facile à
  dépasser. Compte-les.
- **`importance`** : un entier par item, unique dans sa section, 1 pour le plus
  important.
- **`analysis`** : au plus un item par section en porte une. Elle sert à dire
  pourquoi ça compte, pas à résumer une seconde fois.
- **`tags`** : minuscules, sans accent, tirets pour séparer (`k-eta`,
  `semi-conducteurs`). Huit au maximum.
- **`published_at`** : horodatage de l'article source, avec son fuseau. Omets-le
  si la source n'en donne pas de fiable, ne le devine pas.
- **`original_headline`** : quand la source n'écrit pas en français, son titre
  tel quel, recopié sans le traduire ni le raccourcir, et `source_lang` dit sa
  langue. Omets-le pour une source en français : un titre original sans langue,
  ou en français, fait recaler le brief.
- **`date`** : le jour courant à Séoul. Un brief daté d'hier est rejeté en bloc.
- **`events`** : chaque événement porte `start_date` **et** `end_date`, des
  dates réelles, fin ≥ début et fin ≥ aujourd'hui ; un `theme` parmi `anime`,
  `pokemon`, `kpop`, `gaming`, `personnages`, `mode`, `seoul`, `culture`,
  `food`, `sport` ; un `summary` de 40 mots au plus ; un `venue` en coréen, sauf si `map_url` est donné. Un
  événement fautif est écarté, le brief passe, mais un champ inventé dans un
  événement, lui, est une faute de schéma, et le schéma juge le fichier entier.
- Aucun autre champ que ceux listés. Un champ inventé fait rejeter le brief.

### 5. Les sources

- **Ne reconstruis jamais une URL.** Chaque `source_url` doit être une adresse
  que tu as réellement vue, complète, en `https://`. Un contrôle automatique
  interroge chaque lien : une adresse inventée fait disparaître l'item, et une
  adresse inventée qui répondrait par hasard publierait une information fausse.
- Une seule source par item, celle qui porte l'information.
- **Le titre original voyage avec la source.** Quand elle n'écrit pas en
  français, coréen, anglais, japonais, recopie son titre dans
  `original_headline`, exactement comme elle l'a écrit : le lecteur qui remonte
  à la source doit le reconnaître, et un titre coréen se cherche tel quel.
- **Varie les rédactions.** Un brief entier tenu par trois domaines n'est plus
  vraiment une revue de presse. Quand plusieurs sources connues couvrent la même
  information, prends celle qui n'a pas déjà servi ce matin. L'ingestion compte
  les domaines et le dit au journal du run : ce n'est pas une garde, personne ne
  sera recalé pour cela, c'est une habitude à prendre.
- Préfère les sources déjà connues du site, Yonhap, Korea Herald, Korea Times,
  Hankyoreh, Chosun, KBS, Reuters, AP, Ars Technica, The Verge, TechCrunch,
  Eurogamer, GamesIndustry.biz, Polygon, PC Gamer, Inven, BBC Sport, ESPN,
  L'Équipe, K League, KBO. Une
  source hors de cette liste ne disqualifie pas l'item, mais **retient le brief
  entier en brouillon** jusqu'à ce qu'un humain regarde. N'en utilise donc que si
  elle apporte quelque chose qu'aucune source connue ne donne.
- **Jamais le texte intégral d'un article, ni sa traduction complète.** Un résumé
  court, écrit par toi, et le lien. C'est la différence entre une revue de presse
  et une contrefaçon.

### 6. Le ton

Français sobre, phrases courtes, pas de superlatif. Tu écris pour quelqu'un qui
lit son brief en dix minutes le matin. Les noms de champs restent en anglais, la
prose est en français. Pas d'emoji, pas d'exclamation.

Si la journée est creuse, dis-le dans le `standfirst` et laisse les sections
courtes. Un brief honnête et bref vaut mieux qu'un brief étoffé de remplissage.

### 7. Pop-ups et événements

Le site tient un onglet de **tout** ce qui se passe à Séoul et qu'on peut
aller voir : boutiques éphémères, concerts, expositions, salons, festivals.
Dix thèmes le classent : **anime et manga, Pokémon, K-pop, jeu vidéo,
personnages, mode et marques, festivals de Séoul, culture et expos, food et
boissons, sport**. Séoul et sa proche banlieue (Goyang, Seongnam, Incheon), rien
au-delà. Ce qui n'est pas un événement n'y va pas : une boutique permanente
qui ouvre, une promotion en ligne, une sortie de produit sans lieu ni dates.

Le thème, c'est ce qui fait venir les gens. Six d'entre eux demandent une
précision :

- `personnages` : Sanrio, Chiikawa, Miffy, Line Friends, Kakao Friends, Pop
  Mart et Labubu, Sonny Angel, Smiski : le personnage et ses goodies. Une
  série ou un manga (One Piece, Jujutsu Kaisen) reste dans `anime` ; Pokémon
  garde son thème.
- `mode` : les pop-ups de marque **sans idol** : streetwear et sneakers
  (Adidas, Nike, New Balance), enseignes coréennes (Musinsa, Ader Error,
  Gentle Monster, Tamburins), beauté. Un idol en tête d'affiche, Adidas ×
  Jennie, Calvin Klein × Jungkook, c'est `kpop`. Un café, un restaurant, une
  marque de boissons : c'est `food`.
- `seoul` : les grands rendez-vous de la ville, ceux qu'on cite quand on
  demande « qu'est-ce qu'il y a ce week-end » : le pont Jamsu sans voitures,
  les feux d'artifice de Yeouido, les lanternes de Cheonggyecheon, les palais
  ouverts la nuit, les arts de rue, les roseaux de Haneul Park. Ce que la
  ville organise ou annonce (festival.seoul.go.kr, hangang.seoul.go.kr,
  Visit Seoul). Une fête de la bière est `food`, un salon professionnel
  `culture`.
- `culture` : le reste de ce qu'on va voir. Expositions et musées, design,
  photo, patrimoine (palais, temples, cérémonies), papeterie et objets,
  salons, et les concerts qui ne sont pas de la K-pop, un artiste étranger
  à Goyang Stadium, un festival de jazz.
- `food` : cafés et restaurants éphémères, marques de boissons et
  d'alimentation, marchés gourmands, fêtes de la bière.

L'onglet liste tout ce qui est en cours ou annoncé, et chaque événement en sort
de lui-même à sa date de fin. Ton rôle est d'y **ajouter** ce qui est nouveau,
pas de redire ce qui s'y trouve :

- L'onglet tel qu'il est figure dans la veille du § 1 (`/api/evenements.json`,
  à récupérer toi-même seulement si la veille manque). Ce qui y figure est
  déjà connu : ne le propose pas une seconde fois, **sauf si ses dates ont
  changé** (prolongation, report). Repropose-le alors avec le même `name` et
  les dates nouvelles : l'ingestion corrige la fiche au lieu d'en créer une.
  Un événement déjà connu au même lieu, aux mêmes dates et du même thème est
  le même, quel que soit le nom que lui donne une autre rédaction : ne le
  repropose pas sous un autre nom, l'ingestion l'écarterait. Si rien n'est
  disponible, continue sans.
- **Pars des pistes de la veille.** La section « Pistes événements » de
  `veille/AAAA-MM-JJ.md` a été cherchée par Gemini avant ta session, puis
  passée au tri de l'ingestion : allowlist, dates, doublons de l'onglet, lien
  vivant. Ce qui y figure serait retenu. Pour chaque piste, **ouvre sa source
  une fois**, en un seul tour pour toutes, confirme les dates et le lieu, et
  recopie l'objet dans `events`, corrigé si la page dit autre chose, et le
  `name` mis en français si Gemini l'a laissé en coréen ou en anglais. Une
  piste dont la source ne dit pas ce qu'elle annonce se laisse. Une piste
  marquée « dates nouvelles » se repropose avec le nom connu. **Tant qu'il
  reste des pistes, ne cherche pas d'autres événements** : un appel par
  piste, et le § 7 est fini.
- **Ce qui suit ne vaut que si la section manque, dit une panne, ou est
  vide** : alors cherche toi-même, dans les seize appels du budget du § 1.
  Vise quatre à six événements nouveaux, huit au plus. Un matin sans
  événement peut arriver, mais il doit être le résultat d'une recherche, pas
  d'une recherche écourtée : deux requêtes génériques qui s'arrêtent aux deux
  premiers résultats datables ne suffisent pas.
- **Commence par les quatre pages qui listent, en `WebFetch`** : elles
  couvrent à elles seules la plupart des thèmes, pour quatre appels.
  `https://insideseoul.app/popups` rend une trentaine de pop-ups avec lieu et
  dates, anime, personnages, mode, food ; `https://world.nol.com/` les
  expositions et festivals à billet ; `https://kpopofficial.com/schedule/south-korea/`
  les concerts ; `https://festival.seoul.go.kr/festival/year/loadMap.do` les
  festivals de la ville. Demande au fetch ce qui commence dans les deux
  semaines ou vient d'ouvrir, avec lieu, dates et lien. Compare à l'onglet
  tel que la veille le donne **avant** d'ouvrir une fiche : n'ouvre que celles qui
  sont nouvelles, une fois, pour l'adresse et les dates.
- **Puis, pour les thèmes que ces pages n'ont pas couverts, une requête en
  coréen par thème**, avec les mots que les sites coréens emploient,
  `애니메이션` ou `애니`, `만화`, `포켓몬`, `케이팝` ou `아이돌`, `게임` ou
  `e스포츠`, `캐릭터` (ou le nom : `산리오`, `치이카와`), `패션 브랜드`,
  `서울 축제` ou `한강 축제`, `전시회`, `콘서트 서울`, `푸드 팝업`, combinés à
  `팝업스토어`, `전시`, `콘서트`, `페스티벌`, `서울`, le mois en cours.
  L'anglais remonte surtout des agrégateurs ; le coréen remonte les
  rédactions. Une requête par thème, pas une par piste : une piste dont la
  source n'apparaît pas dans les résultats de la requête du thème se laisse.
- **Les autres sources de l'allowlist qui annoncent les événements** ne
  se visitent que pour un thème encore vide : Visit Seoul pour les pop-ups,
  Time Out, Soompi et allkpop pour la K-pop, le Korea JoongAng Daily pour
  les concerts, pokemonkorea.co.kr pour Pokémon, Inven et This Is Game pour
  le jeu vidéo, Hypebeast pour la mode, hangang.seoul.go.kr pour le fleuve,
  COEX et DDP pour les salons. Une recherche `site:` sur l'une d'elles, pas
  une tournée.
- **Les autres agrégateurs de pop-ups sont des pistes, pas des sources.**
  popga, popply, dayforyou, heypop, dealseoul, namu.wiki, Instagram, X ne sont
  dans aucune liste : un événement sourcé chez eux serait écarté. Mais ils
  disent ce qui existe. Quand tu y repères un événement à venir, cherche-le
  ensuite par son nom, et cite ce que tu trouves.
- **Pour un ÉVÉNEMENT, celui qui l'organise est une source.** Un pop-up
  d'idol ou de petite marque ne passe par aucune rédaction : il est annoncé par
  le grand magasin qui l'héberge ou par le label, et sur la seule question qui
  compte ici — cela existe-t-il, à ces dates, à cet endroit ? — cette page vaut
  mieux qu'un article. `config/sources.json` en tient la liste sous
  `event_domains` : grands magasins et enseignes (The Hyundai, Shinsegae,
  Starfield, Musinsa, LCDC), salles (KINTEX, Seoul Arts Center, Sejong),
  marques de personnages (LINE FRIENDS, Pop Mart), labels (YG, HYBE, SM, JYP,
  Blissoo). Elle ne vaut QUE pour `events` : un item d'actualité sourcé là
  retiendrait le brief en brouillon, comme n'importe quel domaine hors de la
  liste du § 5. Et la page doit annoncer l'événement, avec ses dates : une
  page d'accueil ou une fiche produit ne dit rien.
- Un événement introuvable chez une rédaction ET chez celui qui l'organise ne va
  pas dans l'onglet.
- Le brief passe avant : compose-le d'abord, cherche les événements ensuite,
  avec le temps et les appels qui restent. Il reste en général plus de dix
  minutes sur les vingt-cinq de la session : le temps n'est pas ce qui
  manque, c'est le budget d'appels qui borne. L'onglet ne se remplit que par
  ce que tu y déposes.
- **Dates annoncées ou rien.** `start_date` et `end_date` sont celles que la
  source donne ; `end_date` est le dernier jour, inclus, et vaut `start_date`
  pour un événement d'un jour. Un événement sans date de fin annoncée ne va
  pas dans l'onglet.
- **`venue` est le lieu en coréen, tel que Naver Map l'écrit**, `하이커그라운드`,
  `아라아트센터`, `포켓몬센터 성수`, pas « Hiker Ground ». Le site en fait un
  lien de recherche Naver Map, c'est l'épingle par défaut, et une recherche
  en anglais n'y trouve rien : un lieu sans hangul fait écarter l'événement,
  sauf s'il porte un `map_url`. Pour une enseigne à plusieurs adresses, mets
  la succursale dans le lieu (`포켓몬센터 성수`). `area` est le quartier,
  romanisé pour le lecteur : `Seongsu`, `Jung-gu`.
- `map_url` **seulement si tu as vu** la fiche Naver Map du lieu
  (`map.naver.com` ou `naver.me`). Sinon, omets le champ. Même règle pour
  `booking_url` : la billetterie si tu l'as vue, rien sinon.
- `address` **seulement si tu as vu** l'adresse routière coréenne du lieu
  (도로명 주소 : `서울 성동구 아차산로 7`), sur sa fiche Naver Map ou dans la
  source. Le site en fait un pin sur la carte de l'onglet. Sinon, omets le
  champ : jamais une adresse déduite du quartier ou de l'enseigne, et jamais
  en lettres latines, l'ingestion la retirerait.
- La source d'un événement suit les règles du § 5 : une adresse vue, complète,
  d'une rédaction connue. Un événement dont la source est morte ou hors liste
  est **écarté**, il ne retient pas le brief, il disparaît simplement, et le
  journal du run le dit.

---

## Notes de maintenance

- Le contrat ci-dessus doit rester d'accord avec `schemas/brief.schema.json`,
  qui fait foi. En cas de divergence, c'est le schéma qui gagne et l'agent qui
  se fait recaler, donc modifier les deux ensemble.
- La liste des sources citée au § 5 est un extrait de `config/sources.json`, pour
  que l'agent l'ait sous les yeux. Elle n'a pas besoin d'être exhaustive : c'est
  le fichier qui décide, pas le prompt.
- `config/sources.json` tient TROIS rangs, et `scripts/lib/sources.mjs` dit
  pourquoi : `domains`, les rédactions, citables partout ; `event_domains`, ceux
  qui organisent, citables pour un événement seulement ; `aggregators`, les
  recenseurs, jamais cités et nommés là pour que le journal du run dise
  « agrégateur » plutôt que « domaine inconnu ».
- Les pistes actualité du § 1 sont produites par `scripts/actualite.mjs` :
  cinq sessions Gemini en parallèle, une par rubrique (`VOLETS_ACTUALITE`
  dans `scripts/lib/actualite.mjs`, qui nomme le terrain de chacune), dans
  le cadre de `prompts/actualite-presse.md` ; chacune rend un tableau, le
  script sonde chaque adresse, l'allowlist, les doublons du site (titres
  français) et des flux (titres originaux), plafonne par rubrique et par
  domaine, puis ajoute la section à la veille. Corriger ce que Gemini
  cherche se fait dans le prompt et les volets ; ce qui l'écarte, dans le
  tri. Une rubrique en panne est dite « non cherchée » ; les cinq, et la
  section le dit, l'agent compose avec les flux.
- Les pistes événements du § 7 sont produites par `scripts/recherche.mjs` :
  deux sessions Gemini en parallèle, par Antigravity CLI en headless et sans
  droit d'écriture, l'une sur les pages qui listent
  (`prompts/recherche-methode-pages.md`), l'autre sur les rédactions
  coréennes (`prompts/recherche-methode-coreen.md`), dans le cadre commun de
  `prompts/recherche-evenements.md` ; chacune rend un tableau, le script
  les réunit, traduit les salles que les billetteries écrivent en latin
  (`LIEUX_EN_COREEN`), et passe le tout à `contrôlerÉvénements()`, le tri
  même de l'ingestion, puis l'ajoute à la veille. Corriger ce que Gemini
  cherche se fait dans ces prompts-là ; ce qui l'écarte, dans les gardes.
  Une session en panne est une session en moins ; les deux, la section le
  dit et l'agent retombe sur sa propre recherche, avec son budget.
- La veille du § 1 est produite par `scripts/veille.mjs` à partir de
  `config/flux.json`, lancé par `bin/brief-du-jour.sh` juste avant la session.
  Ajouter une rédaction, c'est ajouter son flux là, et son domaine dans
  `sources.json` : un test refuse un flux dont le domaine n'est pas dans
  l'allowlist, sans quoi la veille proposerait des adresses qui retiendraient
  le brief en brouillon. Le fichier n'est pas versionné (`veille/`) : sans
  lui, le prompt fait faire à l'agent la veille par les pages de rubrique.
- `evenements.json` n'existe qu'une fois la collection `mat_events` provisionnée
  et le site redéployé. Tant qu'il manque, l'agent ne sait pas ce qui est déjà
  connu : c'est la garde des doublons de l'ingestion, jouée contre le CMS, qui
  rattrape.
- `recent.json` n'existe qu'une fois le site déployé une première fois. Le prompt
  prévoit son absence, mais tant qu'il manque, l'agent ne peut pas savoir ce qui
  a déjà été couvert, et le contrôle avant vol ne peut pas davantage juger les
  doublons : c'est la garde du CMS qui rattrape, en aval.
- La relecture du § 3 est `scripts/relecture.mjs`, lancée par
  `bin/brief-du-jour.sh` entre la session et le commit, avec
  `prompts/relecture.md` pour consigne et le brief dans la consigne, pas
  lu dans le dépôt. `scripts/lib/relecture.mjs` dit ce qu'elle n'a pas le
  droit de faire et refuse en bloc ce qui le ferait ; le brief relu repasse
  le contrôle avant vol avant de remplacer celui d'inbox/. Le rapport,
  `veille/relecture/relecture-AAAA-MM-JJ.md`, met côte à côte ce que Gemini
  dit avoir changé et ce que le dépôt constate.
- Si le lanceur ne parvient pas à pousser (clé de déploiement révoquée, origin
  injoignable), rien n'arrive dans `inbox/` sur GitHub et **le workflow ne se
  déclenche pas du tout** : il n'y a donc aucune alerte. C'est le seul silence
  connu de la chaîne. Le repérer se fait par l'absence de brief du jour sur le
  site, et le journal du serveur dit pourquoi.
