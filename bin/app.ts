import { Project, AccountStrategy } from '@alma-cdk/project';
import { Environment } from '../lib/environment';

export const project = new Project({
  name: 'alce-assignment',
  author: { name: 'Jan Ondis' },
  defaultRegion: 'eu-north-1',
  accounts: AccountStrategy.two({
    dev: {
      id: '641691899998',
      config: {
        repositories: ['backend'],
        repoPrefix: 'app',
        imageTag: 'dev',
        imagePortMap: { backend: 8080 },
      }
    },
    prod: {
      id: '738404842013',
      config: {
        repositories: ['backend', 'frontend'],
        repoPrefix: 'app',
        imageTag: 'latest',
        imagePortMap: { backend: 8080, frontend: 3000 },
      }
    }
  })
});

new Environment(project);