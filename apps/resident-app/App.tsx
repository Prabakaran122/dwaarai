import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import VehiclesScreen from './src/screens/VehiclesScreen';
import PassesScreen from './src/screens/PassesScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import { useAuthStore } from './src/store/authStore';

export type TabParamList = {
  Home: undefined;
  Vehicles: undefined;
  Passes: undefined;
  Notifications: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return (
      <NavigationContainer>
        <LoginScreen />
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1e40af' },
          headerTintColor: '#fff',
          tabBarActiveTintColor: '#2563eb',
          tabBarInactiveTintColor: '#94a3b8',
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'Dashboard' }}
        />
        <Tab.Screen
          name="Vehicles"
          component={VehiclesScreen}
          options={{ title: 'My Vehicles' }}
        />
        <Tab.Screen
          name="Passes"
          component={PassesScreen}
          options={{ title: 'Visitor Passes' }}
        />
        <Tab.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={{ title: 'Alerts' }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
