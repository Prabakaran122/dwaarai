import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from './src/screens/LoginScreen';
import QueueScreen from './src/screens/QueueScreen';
import ApproveScreen from './src/screens/ApproveScreen';
import OTPVerifyScreen from './src/screens/OTPVerifyScreen';
import IncidentScreen from './src/screens/IncidentScreen';
import { useAuthStore } from './src/store/authStore';

export type RootStackParamList = {
  Login: undefined;
  Queue: undefined;
  Approve: { entryId: string };
  OTPVerify: undefined;
  Incidents: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1e40af' },
          headerTintColor: '#fff',
        }}
      >
        {!isAuthenticated ? (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Queue"
              component={QueueScreen}
              options={{ title: 'Vehicle Queue' }}
            />
            <Stack.Screen
              name="Approve"
              component={ApproveScreen}
              options={{ title: 'Approve Vehicle' }}
            />
            <Stack.Screen
              name="OTPVerify"
              component={OTPVerifyScreen}
              options={{ title: 'Verify OTP' }}
            />
            <Stack.Screen
              name="Incidents"
              component={IncidentScreen}
              options={{ title: 'Log Incident' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
