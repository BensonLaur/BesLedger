import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './app/App.vue';
import Home from './app/pages/Home.vue';
import Accounts from './app/pages/Accounts.vue';
import Events from './app/pages/Events.vue';
import Statistics from './app/pages/Statistics.vue';
import Settings from './app/pages/Settings.vue';
import Books from './app/pages/Books.vue';
import './app/style.css';
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/accounts', component: Accounts },
    { path: '/events', component: Events },
    { path: '/statistics', component: Statistics },
    { path: '/settings', component: Settings },
    { path: '/books', component: Books },
  ],
});
createApp(App).use(router).mount('#app');
