import { Api } from "../api/methods";
import { TranscriptionResult } from "./providers/TranscriptionProvider";
import { TranscriptionSegment } from "./TranscriptionService";

export type RecognizerWord = {
    text: string
    start_time: number
    end_time: number
}

export class WordsPoster {
    private processedSegments: Set<string> = new Set();
    private api: Api;
    private bot_id: Promise<number>;


    constructor() {
        this.api = Api.instance;
        this.bot_id = this.getBotId();
    }

    private async getBotId(): Promise<number> {
        const bot = await this.api.getBot();
        return bot.bot.id;
    }

    public async saveToDatabase(results: TranscriptionResult[], segment: TranscriptionSegment): Promise<void> {
        const segmentKey = `${segment.startTime}-${segment.endTime}`;

        if (this.processedSegments.has(segmentKey)) {
            console.log(`[WordsPoster] Skipping duplicate segment ${segmentKey}`);
            return;
        }

        try {
            this.processedSegments.add(segmentKey);
            
            // Utiliser directement le startTime du segment comme offset
            // au lieu d'une valeur fixe d'offset
            const segmentStartTime = segment.startTime / 1000; // Convertir en secondes
            
            console.log(`[WordsPoster] Processing segment from ${segmentStartTime}s to ${segment.endTime / 1000}s`);
            
            // Transformer les résultats en format RecognizerWord
            // en ajoutant l'offset du segment
            const words: RecognizerWord[] = results.map(result => ({
                text: result.text,
                start_time: result.start_time + segmentStartTime,
                end_time: result.end_time + segmentStartTime
            }));

            await this.api.postWords(words, await this.bot_id);

            console.log(`[WordsPoster] Successfully posted ${words.length} words to DB for segment ${segmentKey}`);
        } catch (error) {
            this.processedSegments.delete(segmentKey);
            console.error(`[WordsPoster] Failed to save to database:`, error);
            throw error;
        }
    }
}
