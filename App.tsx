import React, { useState, useEffect, useCallback, useRef } from 'react';
import LoginScreen from './components/LoginScreen';
import ChatInterface from './components/ChatInterface';
import { ConnectionStatus, Credentials, Message, Sender, WPCategory } from './types';
import { validateWpConnection, getCategories, getCategoryByName, updateCategoryMetadata } from './services/wordpressService';
import { validateGeminiApiKey, getGeminiResponse } from './services/geminiService';

type Theme = 'light' | 'dark';

const App: React.FC = () => {
  const [wpCredentials, setWpCredentials] = useState<Credentials | null>(null);
  const [wpStatus, setWpStatus] = useState<ConnectionStatus>('disconnected');
  const [geminiStatus, setGeminiStatus] = useState<ConnectionStatus>('disconnected');

  const [messages, setMessages] = useState<Message[]>(() => {
    try {
        const savedMessages = localStorage.getItem('chatHistory');
        return savedMessages ? JSON.parse(savedMessages) : [];
    } catch (error) {
        console.error("Failed to parse chat history from localStorage", error);
        return [];
    }
  });
  const [isTyping, setIsTyping] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    if (savedTheme) {
      return savedTheme;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };


  useEffect(() => {
    try {
      localStorage.setItem('chatHistory', JSON.stringify(messages));
    } catch (error) {
      console.error("Failed to save chat history to localStorage", error);
    }
  }, [messages]);

  const handleLogin = async (creds: Credentials) => {
    setWpStatus('connecting');
    setGeminiStatus('connecting');

    const [wpSuccess, geminiSuccess] = await Promise.all([
      validateWpConnection(creds),
      validateGeminiApiKey()
    ]);

    if (wpSuccess) {
      setWpCredentials(creds);
      setWpStatus('connected');
    } else {
      setWpStatus('error');
    }

    if (geminiSuccess) {
      setGeminiStatus('connected');
    } else {
      setGeminiStatus('error');
    }

    if (wpSuccess && geminiSuccess) {
        setMessages([{
            id: Date.now(),
            text: 'Bonjour ! Je suis votre assistant IA pour WordPress. Comment puis-je vous aider aujourd\'hui ? Vous pouvez me demander de "lister les catégories de produits" pour commencer.',
            sender: Sender.AI,
            timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        }]);
    }
  };

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setIsTyping(false);
  }, []);
  
  const handleSendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !wpCredentials) return;

    const userMessage: Message = {
      id: Date.now(),
      text,
      sender: Sender.User,
      timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
        const aiResponseText = await getGeminiResponse(text, messages);
        
        if (controller.signal.aborted) {
            console.log("AI response generation was stopped by the user.");
            return;
        }

        let actionResponse = null;
        try {
            const parsedResponse = JSON.parse(aiResponseText);
            if(parsedResponse.action && wpCredentials){
                switch(parsedResponse.action){
                    case 'LIST_CATEGORIES':
                        const categories = await getCategories(wpCredentials);
                        actionResponse = `Voici les catégories de produits trouvées : \n\n - ${categories.map(c => c.name).join('\n - ')}`;
                        break;
                    case 'GET_CATEGORY_METADATA': {
                        const categoryNameToFind = parsedResponse.payload.categoryName;
                        if (!categoryNameToFind) {
                            actionResponse = "Veuillez spécifier un nom de catégorie.";
                            break;
                        }
                        const { exactMatch, suggestions } = await getCategoryByName(wpCredentials, categoryNameToFind);
                        
                        if (exactMatch) {
                            const category = exactMatch;
                            const yoastTitle = category.yoast_head_json?.title || 'Non défini';
                            const yoastDesc = category.yoast_head_json?.description || 'Non définie';
                            const yoastFocusKw = category._yoast_wpseo_focuskw || 'Non définie';
                            const slug = category.slug || 'Non défini';

                            actionResponse = `Voici les métadonnées pour "${category.name}":\n\n- Description: ${category.description || 'Non définie'}\n- Slug: ${slug}\n- Titre SEO (Yoast): ${yoastTitle}\n- Méta Description (Yoast): ${yoastDesc}\n- Expression-clé principale (Yoast): ${yoastFocusKw}`;
                        } else if (suggestions.length > 0) {
                            const suggestionList = suggestions.map(s => `"${s.name}"`).join('\n - ');
                            actionResponse = `Je n'ai pas trouvé de correspondance exacte pour "${categoryNameToFind}".\n\nVouliez-vous dire l'une de ces catégories ?\n - ${suggestionList}`;
                        } else {
                            actionResponse = `Désolé, je n'ai pas trouvé de catégorie nommée "${categoryNameToFind}" ou s'en approchant.`;
                        }
                        break;
                    }
                    case 'UPDATE_CATEGORY_METADATA': {
                         const { categoryName, metaDescription, metaTitle, description, name, slug, focusKeyphrase } = parsedResponse.payload;
                         
                         if (!categoryName) {
                            actionResponse = "Veuillez spécifier un nom de catégorie à mettre à jour.";
                            break;
                         }

                         const { exactMatch, suggestions } = await getCategoryByName(wpCredentials, categoryName);

                         if (exactMatch) {
                            const categoryToUpdate = exactMatch;
                            const updatePayload: Partial<WPCategory> = {};
                            if (description !== undefined) updatePayload.description = description;
                            if (name) updatePayload.name = name;
                            if (slug) updatePayload.slug = slug;
                            
                            if (metaTitle) updatePayload._yoast_wpseo_title = metaTitle;
                            if (metaDescription) updatePayload._yoast_wpseo_metadesc = metaDescription;
                            if (focusKeyphrase) updatePayload._yoast_wpseo_focuskw = focusKeyphrase;
                            
                            if (Object.keys(updatePayload).length === 0) {
                                actionResponse = "Aucune modification à appliquer. Veuillez spécifier un champ à modifier.";
                                break;
                            }

                            try {
                                await updateCategoryMetadata(wpCredentials, categoryToUpdate.id, updatePayload);
                                actionResponse = `La catégorie "${name || categoryName}" a été mise à jour avec succès.`;
                            } catch (e) {
                                console.error("Failed to update category:", e);
                                actionResponse = `Une erreur est survenue lors de la mise à jour de la catégorie "${categoryName}".`;
                            }
                         } else if (suggestions.length > 0) {
                            const suggestionList = suggestions.map(s => `"${s.name}"`).join('\n - ');
                            actionResponse = `Je n'ai pas trouvé de correspondance exacte pour "${categoryName}" à mettre à jour.\n\nVouliez-vous dire l'une de ces catégories ?\n - ${suggestionList}`;
                         } else {
                            actionResponse = `Désolé, je n'ai pas trouvé de catégorie nommée "${categoryName}" à mettre à jour.`;
                         }
                        break;
                    }
                    case 'COPY_YOAST_META_DESC_TO_DESC': {
  const categoryNameToCopyFrom = parsedResponse.payload.categoryName;
  if (!categoryNameToCopyFrom) {
    break; // Sort du bloc 'case' si la condition est vraie
  }
  // Ajoutez votre autre logique ici si nécessaire
  break; // Important pour éviter de continuer vers le 'case' suivant
}
