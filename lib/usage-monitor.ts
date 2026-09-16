import { createUsageReporter } from './openlux-usage';
import { getMainAppUrl } from './main-app-sso';
export const usageReporter = createUsageReporter({ tool: 'sabc', getMainAppUrl });
