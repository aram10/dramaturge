<template>
  <div id="dashboard-root">
    <button data-testid="refresh-btn">Refresh</button>
    <span data-testid="status-indicator">Online</span>
    <router-link to="/about">About</router-link>
    <router-link to="/contact">Contact</router-link>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goToProfile(id: string) {
  router.push('/users/' + id);
}
</script>
