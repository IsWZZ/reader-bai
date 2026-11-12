import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './assets/css/index.css'
import App from './App.vue'
import router from './router'
import { useSettingsStore } from './store/settings'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia).use(router)

// 挂载前先加载设置并应用主题，避免启动时的明暗闪烁
void useSettingsStore(pinia)
  .initialize()
  .finally(() => app.mount('#app'))
