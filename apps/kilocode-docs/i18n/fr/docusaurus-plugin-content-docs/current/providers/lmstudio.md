---
sidebar_label: LM Studio
---

# Utiliser LM Studio avec Kilo Code

Kilo Code supporte l'exécution de modèles localement en utilisant LM Studio. LM Studio fournit une interface conviviale pour télécharger, configurer et exécuter des modèles de langage locaux. Il inclut aussi un serveur d'inférence local intégré qui émule l'API OpenAI, le rendant facile à intégrer avec Kilo Code.

**Site Web :** [https://lmstudio.ai/](https://lmstudio.ai/)

## Configuration de LM Studio

1.  **Télécharger et Installer LM Studio :** Téléchargez LM Studio depuis le [site web LM Studio](https://lmstudio.ai/).
2.  **Télécharger un Modèle :** Utilisez l'interface LM Studio pour chercher et télécharger un modèle. Certains modèles recommandés incluent :

    - Modèles CodeLlama (par ex., `codellama:7b-code`, `codellama:13b-code`, `codellama:34b-code`)
    - Modèles Mistral (par ex., `mistralai/Mistral-7B-Instruct-v0.1`)
    - Modèles DeepSeek Coder (par ex., `deepseek-coder:6.7b-base`)
    - Tout autre modèle qui est supporté par Kilo Code, ou pour lequel vous pouvez définir la fenêtre de contexte.

    Cherchez des modèles en format GGUF. LM Studio fournit une interface de recherche pour trouver et télécharger des modèles.

3.  **Démarrer le Serveur Local :**
    - Ouvrez LM Studio.
    - Cliquez sur l'onglet **"Serveur Local"** (l'icône ressemble à `<->`).
    - Sélectionnez le modèle que vous avez téléchargé.
    - Cliquez sur **"Démarrer le Serveur"**.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "LM Studio" dans le menu déroulant "Fournisseur API".
3.  **Saisir l'ID de Modèle :** Saisissez le _nom de fichier_ du modèle que vous avez chargé dans LM Studio (par ex., `codellama-7b.Q4_0.gguf`). Vous pouvez trouver ceci dans l'onglet "Serveur Local" de LM Studio.
4.  **(Optionnel) URL de Base :** Par défaut, Kilo Code se connectera à LM Studio à `http://localhost:1234`. Si vous avez configuré LM Studio pour utiliser une adresse ou un port différent, saisissez l'URL complète ici.
5.  **(Optionnel) Délai d'Attente :** Par défaut, les requêtes API expirent après 10 minutes. Les modèles locaux peuvent être lents, si vous atteignez ce délai d'attente vous pouvez considérer l'augmenter ici : Panneau Extensions VS Code > Menu d'engrenage Kilo Code > Paramètres > Délai d'Attente de Requête API.

## Conseils et Notes

- **Exigences de Ressources :** Exécuter des modèles de langage volumineux localement peut demander beaucoup de ressources. Assurez-vous que votre ordinateur répond aux exigences minimums pour le modèle que vous choisissez.
- **Sélection de Modèle :** LM Studio fournit une large gamme de modèles. Expérimentez pour trouver celui qui convient le mieux à vos besoins.
- **Serveur Local :** Le serveur local LM Studio doit fonctionner pour que Kilo Code puisse s'y connecter.
- **Documentation LM Studio :** Référez-vous à la [documentation LM Studio](https://lmstudio.ai/docs) pour plus d'informations.
- **Dépannage :** Si vous voyez une erreur "Veuillez vérifier les logs développeur LM Studio pour déboguer ce qui s'est mal passé", vous pourriez avoir besoin d'ajuster les paramètres de longueur de contexte dans LM Studio.
