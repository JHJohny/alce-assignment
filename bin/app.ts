import { Project, AccountStrategy } from '@alma-cdk/project';


export const project = new Project({
  name: 'alce-assignment',
  author: { name: 'Jan Ondis' },
  defaultRegion: 'eu-north-1',  // Cheapest one
  accounts: AccountStrategy.two({
    dev:  { id: '641691899998', config: {  } },
    prod: { id: '738404842013', config: {  } }
  }),
});

new Environment(project);