---
sidebar_label: Virtual Quota Fallback
---

# Utiliser le Fournisseur Virtual Quota Fallback

Le fournisseur Virtual Quota Fallback est un meta-fournisseur puissant qui vous permet de configurer et de gérer plusieurs fournisseurs API, basculant automatiquement entre eux basé sur des limites d'utilisation prédéfinies et la disponibilité. Ceci vous assure de maximiser votre utilisation des services de niveau gratuit et de maintenir un accès continu aux modèles d'IA en basculant de manière transparente vers d'autres fournisseurs quand un reach sa limite ou rencontre une erreur.

C'est la solution parfaite pour les utilisateurs qui exploitent plusieurs services LLM et veulent les orchestrer intelligemment - par exemple, utiliser un fournisseur gratuit jusqu'à sa limite avant de basculer automatiquement vers un service de paiement à l'utilisation.

## Comment ça fonctionne

Le fournisseur Virtual Quota Fallback ne se connecte pas directement à un service LLM. Au lieu de cela, il agit comme un gestionnaire pour vos autres profils de fournisseur configurés.

- **Liste Priorisée :** Vous créez une liste priorisée de vos profils de fournisseur existants. Le fournisseur en haut de la liste est utilisé en premier.
- **Suivi d'Utilisation :** Vous pouvez définir des limites personnalisées pour chaque fournisseur basé sur le nombre de tokens ou de requêtes par minute, heure, ou jour. Kilo Code suit l'utilisation pour chaque fournisseur contre ces limites.
- **Fallback Automatique :** Quand le fournisseur actuellement actif dépasse une de ses limites définies ou retourne une erreur API, le système le désactive temporairement automatiquement et bascule vers le prochain fournisseur disponible dans votre liste.
- **Notifications :** Vous recevrez un message d'information dans VS Code chaque fois qu'un basculement automatique se produit, vous tenant informé de quel fournisseur est actuellement actif.

## Prérequis

Avant de configurer ce fournisseur, vous devez avoir au moins un autre fournisseur API déjà configuré comme un profil séparé dans Kilo Code. Ce fournisseur n'est utile que s'il y a d'autres profils pour qu'il puisse les gérer.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "Virtual Quota Fallback" dans le menu déroulant "Fournisseur API". Ceci ouvrira son panneau de configuration dédié.

<img src="/docs/img/providers/virtualQuotaSelectDropdown.png" alt="Sélection du menu déroulant virtuaQuotaFallback dans les paramètres Kilo Code" width="600" />

3.  **Ajouter un Profil de Fournisseur :**

    - Dans le panneau de configuration, cliquez sur le bouton **"Ajouter Profil"** pour créer une nouvelle entrée dans la liste.
    - Cliquez sur le menu déroulant sur la nouvelle entrée pour sélectionner un de vos autres profils de fournisseur préconfigurés (par ex., "OpenAI", "Chutes AI Free Tier").

4.  **Définir les Limites d'Utilisation (Optionnel) :**

    - Une fois qu'un profil est ajouté, vous pouvez spécifier des limites d'utilisation. Si vous laissez ces champs vides, aucune limite ne sera appliquée pour cette métrique spécifique.
    - **Tokens par minute/heure/jour :** Limite l'utilisation basée sur le nombre total de tokens traités (entrée + sortie).
    - **Requêtes par minute/heure/jour :** Limite le nombre total d'appels API effectués.

5.  **Ordonner Vos Fournisseurs :**

    - L'ordre des profils est crucial, car il définit la priorité de fallback. Le fournisseur en haut est utilisé en premier.
    - Utilisez les **flèches haut et bas** à côté de chaque profil pour changer sa position dans la liste.

6.  **Ajouter Plus de Fournisseurs :** Répétez les étapes 3-5 pour construire votre chaîne de fallback complète. Vous pouvez ajouter autant de profils que vous avez configurés.

<img src="/docs/img/providers/virtualQuotaFullConfig.png" alt="Configuration virtuaQuotaFallback dans les paramètres Kilo Code" width="600" />

## Surveillance d'Utilisation

L'écran de configuration sert aussi de tableau de bord pour surveiller l'utilisation actuelle de chaque fournisseur dans votre liste.

- Vous pouvez voir les tokens et requêtes utilisés dans la dernière minute, heure, et jour.
- Si vous avez besoin de réinitialiser ces compteurs, cliquez sur le bouton **"Effacer les Données d'Utilisation"**. Ceci réinitialisera toutes les statistiques à zéro et réactivera immédiatement tous les fournisseurs qui étaient temporairement désactivés pour avoir dépassé leurs limites.

## Exemple de Cas d'Utilisation

Imaginez que vous avez deux profils configurés :

1.  **Chutes AI Gratuit :** Un fournisseur de niveau gratuit avec une limite de 5,000 tokens par heure.
2.  **OpenAI Payé :** Votre compte OpenAI personnel de paiement à l'utilisation.

**Configuration :**

- Placez "Chutes AI Gratuit" en premier dans la liste.
- Définissez sa limite "Tokens par heure" à `5000`.
- Placez "OpenAI Payé" en second dans la liste, sans limites définies.

**Résultat :**
Kilo Code enverra toutes les requêtes à Chutes AI. Une fois que votre utilisation dépasse 5,000 tokens dans une heure, il basculera automatiquement vers votre compte OpenAI. Le système rebasculera vers Chutes AI dans l'heure suivante quand sa fenêtre de quota aura été réinitialisée.

## Conseils et Notes

- **La Priorité est Clé :** Vérifiez toujours deux fois l'ordre de vos profils. Les fournisseurs primaires ou de niveau gratuit intentionnels devraient être en haut.
- **Fallback Basé sur Erreur :** Si vous ne définissez aucune limite pour un profil, le fallback ne se produira que si l'API du fournisseur retourne une erreur (par ex., une limite de débit dure du service lui-même, un problème de réseau, ou une clé API invalide).
- **Pas d'Imbrication :** Vous ne pouvez pas sélectionner un autre profil "Virtual Quota Fallback" dans la configuration de ce fournisseur, car cela créerait une dépendance circulaire.
