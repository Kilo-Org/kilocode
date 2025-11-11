# browser_action

L'outil `browser_action` permet l'automatisation web et l'interaction via un navigateur contrôlé par Puppeteer. Il permet à Kilo Code de lancer des navigateurs, naviguer vers des sites web, cliquer sur des éléments, taper du texte, et faire défiler des pages avec retour visuel à travers des captures d'écran.

## Paramètres

L'outil accepte ces paramètres :

- `action` (requis) : L'action à effectuer :
    - `launch` : Démarrer une nouvelle session de navigateur à une URL
    - `click` : Cliquer à des coordonnées x,y spécifiques
    - `type` : Taper du texte via le clavier
    - `scroll_down` : Faire défiler vers le bas d'une hauteur de page
    - `scroll_up` : Faire défiler vers le haut d'une hauteur de page
    - `close` : Terminer la session de navigateur
- `url` (optionnel) : L'URL vers laquelle naviguer lors de l'utilisation de l'action `launch`
- `coordinate` (optionnel) : Les coordonnées x,y pour l'action `click` (par ex. "450,300")
- `text` (optionnel) : Le texte à taper lors de l'utilisation de l'action `type`

## Ce qu'il fait

Cet outil crée une session de navigateur automatisée que Kilo Code peut contrôler pour naviguer sur des sites web, interagir avec des éléments, et effectuer des tâches qui nécessitent l'automatisation de navigateur. Chaque action fournit une capture d'écran de l'état actuel, permettant la vérification visuelle du processus.

## Quand est-il utilisé ?

- Quand Kilo Code a besoin d'interagir avec des applications web ou sites web
- Quand tester des interfaces utilisateur ou fonctionnalités web
- Quand capturer des captures d'écran de pages web
- Quand démontrer des workflows web visuellement

## Caractéristiques Clés

- Fournit un retour visuel avec des captures d'écran après chaque action et capture les journaux de console
- Supporte des workflows complets du lancement à l'interaction avec la page à la fermeture
- Permet des interactions précises via coordonnées, saisie clavier, et défilement
- Maintient des sessions de navigateur consistantes avec détection intelligente de chargement de page
- Opère en deux modes : local (instance Puppeteer isolée) ou distant (se connecte à Chrome existant)
- Gère les erreurs gracieusement avec nettoyage automatique de session et messages détaillés
- Optimise la sortie visuelle avec support pour divers formats et paramètres de qualité
- Suit l'état d'interaction avec indicateurs de position et historique d'actions

## Modes de Navigateur

L'outil opère en deux modes distincts :

### Mode Navigateur Local (Défaut)

- Télécharge et gère une instance Chromium locale à travers Puppeteer
- Crée un environnement navigateur frais à chaque lancement
- Pas d'accès aux profils utilisateur existants, cookies, ou extensions
- Comportement consistant et prévisible dans un environnement sandboxé
- Ferme complètement le navigateur quand la session se termine

### Mode Navigateur Distant

- Se connecte à une instance Chrome/Chromium existante fonctionnant avec le débogage distant activé
- Peut accéder à l'état de navigateur existant, cookies, et potentiellement extensions
- Démarrage plus rapide car il réutilise un processus navigateur existant
- Supporte la connexion à des navigateurs dans des conteneurs Docker ou sur des machines distantes
- Se déconnecte seulement (ne ferme pas) du navigateur quand la session se termine
- Nécessite que Chrome fonctionne avec le port de débogage distant ouvert (typiquement port 9222)

## Limitations

- Pendant que le navigateur est actif, seul l'outil `browser_action` peut être utilisé
- Les coordonnées de navigateur sont relatives à la fenêtre d'affichage, pas à la page
- Les actions de clic doivent cibler des éléments visibles dans la fenêtre d'affichage
- Les sessions de navigateur doivent être explicitement fermées avant d'utiliser d'autres outils
- La fenêtre de navigateur a des dimensions configurables (par défaut 900x600)
- Ne peut pas interagir directement avec les DevTools du navigateur
- Les sessions de navigateur sont temporaires et ne persistent pas à travers les redémarrages de Kilo Code
- Fonctionne seulement avec les navigateurs Chrome/Chromium, pas Firefox ou Safari
- Le mode local n'a pas d'accès aux cookies existants ; le mode distant nécessite Chrome avec débogage activé

## Comment ça fonctionne

Quand l'outil `browser_action` est invoqué, il suit ce processus :

1. **Validation d'Action et Gestion de Navigateur** :

    - Valide les paramètres requis pour l'action demandée
    - Pour `launch` : Initialise une session de navigateur (soit instance Puppeteer locale ou Chrome distant)
    - Pour les actions d'interaction : Utilise la session de navigateur existante
    - Pour `close` : Termine ou se déconnecte du navigateur appropriément

2. **Interaction et Stabilité de Page** :

    - S'assure que les pages sont entièrement chargées en utilisant la détection de stabilité DOM via l'algorithme `waitTillHTMLStable`
    - Exécute les actions demandées (navigation, clic, saisie, défilement) avec un timing approprié
    - Surveille l'activité réseau après les clics et attend la navigation quand nécessaire

3. **Retour Visuel** :

    - Capture des captures d'écran optimisées en utilisant le format WebP (avec fallback PNG)
    - Enregistre les journaux de console du navigateur pour des fins de débogage
    - Suit la position de la souris et maintient un historique paginé d'actions

4. **Gestion de Session** :
    - Maintient l'état de navigateur à travers plusieurs actions
    - Gère les erreurs et nettoie automatiquement les ressources
    - Applique la séquence de workflow appropriée (launch → interactions → close)

## Séquence de Workflow

Les interactions de navigateur doivent suivre cette séquence spécifique :

1. **Initialisation de Session** : Tous les workflows de navigateur doivent commencer avec une action `launch`
2. **Phase d'Interaction** : Plusieurs actions `click`, `type`, et scroll peuvent être effectuées
3. **Fin de Session** : Tous les workflows de navigateur doivent finir avec une action `close`
4. **Changement d'Outil** : Après avoir fermé le navigateur, d'autres outils peuvent être utilisés

## Exemples d'Utilisation

- En créant un processus de soumission de formulaire web, Kilo Code lance un navigateur, navigue vers le formulaire, remplit les champs avec l'action `type`, et clique sur soumettre.
- En testant un site web responsive, Kilo Code navigue vers le site et utilise des actions de défilement pour examiner différentes sections.
- En capturant des captures d'écran d'une application web, Kilo Code navigue à travers différentes pages et prend des captures d'écran à chaque étape.
- En démontrant un flux de checkout e-commerce, Kilo Code simule tout le processus de la sélection de produit à la confirmation de paiement.

## Exemples d'Usage

Lancer un navigateur et naviguer vers un site web :

```
<browser_action>
<action>launch</action>
<url>https://example.com</url>
</browser_action>
```

Cliquer à des coordonnées spécifiques (par ex. un bouton) :

```
<browser_action>
<action>click</action>
<coordinate>450,300</coordinate>
</browser_action>
```

Taper du texte dans un champ de saisie concentré :

```
<browser_action>
<action>type</action>
<text>Hello, World!</text>
</browser_action>
```

Faire défiler vers le bas pour voir plus de contenu :

```
<browser_action>
<action>scroll_down</action>
</browser_action>
```

Fermer la session de navigateur :

```
<browser_action>
<action>close</action>
</browser_action>
```
