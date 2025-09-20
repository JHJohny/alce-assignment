import { Project, AccountStrategy } from '@alma-cdk/project';
import { Environment } from '../lib/environment';

export const project = new Project({
  name: 'alce-assignment',
  author: { name: 'Jan Ondis' },
  defaultRegion: 'eu-north-1',  // Cheapest one
  accounts: AccountStrategy.two({
    // TODO - probably move config to stack level
    dev:  { id: '641691899998', config: { maxCount: 2 } },
    prod: { id: '738404842013', config: { maxCount: 3 } }
  }),
});

new Environment(project);