export interface Credentials {
  wpUrl: string;
  username: string;
  appPassword: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export enum Sender {
    User = 'user',
    AI = 'ai'
}

export interface Message {
  id: number;
  text: string;
  sender: Sender;
  timestamp: string;
}

export interface WPCategory {
    id: number;
    name: string;
    slug: string;
    description: string;
    // La lecture du titre et de la description se fait via ce champ, qui fonctionnait bien
    yoast_head_json?: {
        title?: string;
        description?: string;
    };
    // Les clés de métadonnées explicites sont utilisées pour la mise à jour et la tentative de lecture de l'expression-clé
    _yoast_wpseo_title?: string;
    _yoast_wpseo_metadesc?: string;
    _yoast_wpseo_focuskw?: string;
}
