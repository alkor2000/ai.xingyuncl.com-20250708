// Local components with synthetic API data supplied by the browser test. Never proxy production.
import {createServer} from '../../frontend/node_modules/vite/dist/node/index.js';
import react from '../../frontend/node_modules/@vitejs/plugin-react/dist/index.js';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const server=await createServer({root,configFile:false,plugins:[react()],resolve:{dedupe:['react','react-dom'],alias:{react:path.join(root,'frontend/node_modules/react'),'react-dom':path.join(root,'frontend/node_modules/react-dom'),antd:path.join(root,'frontend/node_modules/antd'),'react-i18next':path.join(root,'frontend/node_modules/react-i18next')}},server:{host:'127.0.0.1',port:4417,strictPort:true,fs:{allow:[root,'/home/hanying/ai-platform/frontend/node_modules']}}});
await server.listen();console.log('Local fixture: http://127.0.0.1:4417/dev/gallery-moderation-preview/index.html');
