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
        enablePullThroughCache: true,
        cachePrefix: 'dockerhub',
        upstreamRegistryUrl: 'registry-1.docker.io',
      },
    },
    prod: {
      id: '738404842013',
      config: {
        repositories: ['backend', 'frontend'],
        repoPrefix: 'app',
        enablePullThroughCache: true,
        cachePrefix: 'dockerhub',
        upstreamRegistryUrl: 'registry-1.docker.io',
      },
    },
  }),
});

new Environment(project);
