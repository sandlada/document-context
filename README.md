# @sandlada/document-context

![npm version](https://img.shields.io/npm/v/@sandlada/document-context?label=NPM%20Version&labelColor=%2300531f&color=%23a3f5aa)
![GitHub License](https://img.shields.io/github/license/sandlada/document-context?label=License&labelColor=%2300531f&color=%23a3f5aa)

For private use. A function-first IoC container hosted on HTML objects.

## Usage

```ts
import { createContext, mount, updateState, subscribeState } from '@sandlada/document-context';

const ctx = createContext({ count: 0, label: 'en' });
const session = mount(document, ctx, {
    sync: { target: document.documentElement, properties: { count: 'dataset.count', label: 'lang' } },
});
subscribeState(session, console.log);
updateState(session, { count: 1 });
```
