import { Routes } from '@angular/router';
import { keycloakAuthGuard } from './guards/keycloak-auth.guard';
import {
  GameRunnerComponent,
  HistoryService,
  historyRouteResolver,
  HISTORY_DATA_PROVIDER,
  RealHistoryDataProvider,
} from '@nexosdi.synapxix/game-engine/core';
import { MapComponent } from '../components/map.component';
import { SplashComponent } from '../components/splash.component';
import { DashboardComponent } from '../components/dashboard/dashboard.component';
import { RoadmapBuilderComponent } from '../teachers-form/roadmap-builder.component';
import { ShopComponent } from '../components/shop/shop.component';


/**
 * Definición de rutas del web-game.
 * Las rutas protegidas (ej. shop, dashboard e history) utilizan el guard
 * `keycloakAuthGuard` para requerir token válido desde el servidor Keycloak del VPS.
 * La ruta raíz (splash) es pública.
 */
export const routes: Routes = [
  {
    path: 'shop',
    component: ShopComponent,
    canActivate: [keycloakAuthGuard],
  },
  {
    path: '',
    component: SplashComponent,
  },
  // Prueba técnica del Nodo 1, sin guard para abrirla en tablets. Registra en
  // D.A.L.A. v2 solo con sesión iniciada y consentimiento vigente; sin sesión
  // se juega igual y no se guarda nada.
  {
    path: 'spike/nodo1',
    loadComponent: () =>
      import('./spike-nodo1/nodo1-spike.component').then((m) => m.Nodo1SpikeComponent),
  },
  {
    path: 'spike/pasillo',
    loadComponent: () =>
      import('./spike-nodo1/pasillo-spike.component').then((m) => m.PasilloSpikeComponent),
  },
 { path: 'dashboard',
   component: DashboardComponent, 
   canActivate: [keycloakAuthGuard],
 },
  {
    path: 'history/:historyId',
    canActivate: [keycloakAuthGuard],
    providers: [
      HistoryService,
      RealHistoryDataProvider,
      { provide: HISTORY_DATA_PROVIDER, useExisting: RealHistoryDataProvider },
    ],
    resolve: {
      historyReady: historyRouteResolver,
    },
    children: [
      {
        path: '',
        redirectTo: 'map',
        pathMatch: 'full',
      },
      {
        path: 'map',
        component: MapComponent,
      },
      {
        path: 'game',
        component: GameRunnerComponent,
      },
      {
        path: 'admin/builder',
        component: RoadmapBuilderComponent,
      },
    ],
  },
  // Esta ruta captura cualquier error de tipeo en la URL y vuelve al inicio
  {
    path: '**',
    redirectTo: '',
  },
];