import { createUsageReporter } from '../lib/openlux-usage.ts';
await createUsageReporter({tool:'sabc',getMainAppUrl:()=>process.env.MAIN_APP_URL?.trim() || 'https://www.qycm.top'}).flush();
