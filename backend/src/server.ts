import app from './app';
import { runDailyBriefTick } from './dailyBrief';
import { DAILY_BRIEF_CONFIG } from './dailyBriefConfig';

const PORT = 3000;
const runScheduledBriefs = () => {
    try {
        const result = runDailyBriefTick();
        if (result.generated) {
            console.log(`[Daily brief] Generated ${result.userIds.length} briefs for ${result.briefDate}.`);
        }
    } catch (error) {
        console.error('[Daily brief] Scheduled generation failed.', error);
    }
};

app.listen(PORT, () => {
    console.log(`Jeweltech Backend running on http://localhost:${PORT}`);
    runScheduledBriefs();
    setInterval(runScheduledBriefs, DAILY_BRIEF_CONFIG.schedule.pollIntervalMs).unref();
});