import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import App from './App.vue';
import './style.css';
import './ui-refresh.css';

createApp(App).use(ElementPlus).mount('#app');
