---
title: Autocomplétion
sidebar_position: 4
---

# Autocomplétion

La fonctionnalité d'autocomplétion de Kilo Code fournit des suggestions et complétions de code intelligentes pendant que vous tapez, vous aidant à écrire du code plus rapidement et plus efficacement. Elle offre des options de déclenchement automatique et manuel.

## Fonctionnement de l'Autocomplétion

L'autocomplétion analyse votre contexte de code et fournit :

- **Complétions en ligne** pendant que vous tapez
- **Corrections rapides** pour les motifs de code courants
- **Suggestions contextuelles** basées sur votre code environnant
- **Complétions multi-lignes** pour les structures de code complexes

La fonctionnalité utilise votre fournisseur d'IA sélectionné pour générer des suggestions intelligentes qui correspondent à votre style de codage et au contexte de votre projet.

## Options de Déclenchement

### Pause pour Compléter

Lorsqu'elle est activée, Kilo Code déclenche automatiquement l'autocomplétion lorsque vous faites une pause en tapant. Cela offre une expérience de codage fluide où les suggestions apparaissent naturellement pendant que vous travaillez.

- **Délai de déclenchement automatique** : Configurez le délai (en secondes) avant que l'autocomplétion ne se déclenche après que vous ayez arrêté de taper
- La valeur par défaut est de 3 secondes, mais cela peut être ajusté vers le haut ou vers le bas
- Des délais plus courts signifient des suggestions plus rapides mais peuvent être plus gourmands en ressources

### Tâche Rapide (Cmd+I)

Besoin de faire un changement rapide ? La fonctionnalité Tâche Rapide vous permet de :

1. Sélectionner du code dans votre éditeur (ou placer votre curseur où vous voulez des changements)
2. Appuyer sur `Cmd+I` (Mac) ou `Ctrl+I` (Windows/Linux)
3. Décrire votre objectif en anglais simple
4. Recevoir une suggestion de code sans passer par le chat

**Exemples :**

- "créer un composant React avec ces props"
- "ajouter une gestion des erreurs à cette fonction"
- "convertir ceci en TypeScript"
- "optimiser cette boucle pour les performances"

Vous pouvez personnaliser le raccourci clavier dans les paramètres des raccourcis clavier de VS Code.

### Autocomplétion Manuelle (Cmd+L)

Pour plus de contrôle sur le moment où les suggestions apparaissent :

1. Positionnez votre curseur où vous avez besoin d'aide
2. Appuyez sur `Cmd+L` (Mac) ou `Ctrl+L` (Windows/Linux)
3. Kilo Code analyse le contexte environnant
4. Recevez des améliorations ou complétions immédiates

Ceci est idéal pour :

- Corrections rapides
- Complétions de code
- Suggestions de refactoring
- Vous maintenir dans le flux sans interruptions

Vous pouvez également personnaliser ce raccourci clavier dans vos paramètres VS Code.

## Désactiver l'Autocomplétion Concurrente

Nous recommandons de désactiver les autocomplétions concurrentes pour optimiser votre expérience avec Kilo Code. Pour désactiver l'autocomplétion GitHub Copilot dans VSCode, allez dans **Paramètres** et naviguez vers **GitHub** > **Copilot : Avancé** (ou recherchez 'copilot').

Ensuite, basculez sur 'désactivé' :

<img
  src="https://github.com/user-attachments/assets/60c69417-1d1c-4a48-9820-5390c30ae25c"
  alt="Disable GitHub Copilot in VSCode"
  width="800"
/>

Si vous utilisez Cursor, allez dans **Paramètres** > **Paramètres Cursor** > **Tab**, et désactivez 'Cursor Tab' :

<img
  src="https://github.com/user-attachments/assets/fd2eeae2-f770-40ca-8a72-a9d5a1c17d47"
  alt="Disable Cursor autocomplete"
  width="800"
/>

## Bonnes Pratiques

1. **Équilibrer vitesse et qualité** : Les modèles plus rapides fournissent des suggestions plus rapides mais peuvent être moins précis
2. **Ajuster le délai de déclenchement** : Trouvez le juste milieu entre la réactivité et l'évitement de trop nombreux appels API
3. **Utiliser Tâche Rapide pour les changements complexes** : Elle est conçue pour des modifications de code plus substantielles
4. **Utiliser l'Autocomplétion Manuelle pour la précision** : Lorsque vous avez besoin de suggestions à des moments spécifiques
5. **Configurer les fournisseurs judicieusement** : Envisagez d'utiliser des modèles plus rapides et moins chers pour l'autocomplétion tout en gardant des modèles plus puissants pour le chat

## Conseils

- L'autocomplétion fonctionne mieux avec un code clair et bien structuré
- Les commentaires au-dessus des fonctions aident l'autocomplétion à comprendre l'intention
- Les noms de variables et de fonctions importent - des noms descriptifs mènent à de meilleures suggestions

## Fonctionnalités Connexes

- [Actions de Code](../features/code-actions) - Options de menu contextuel pour les tâches de codage courantes
