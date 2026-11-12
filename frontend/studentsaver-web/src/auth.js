import {
  CognitoUserPool, CognitoUser,
  AuthenticationDetails, CognitoUserAttribute,
} from 'amazon-cognito-identity-js';
import { COGNITO_CONFIG } from './config';

const userPool = new CognitoUserPool(COGNITO_CONFIG);

export function signUp(email, password) {
  const attrs = [new CognitoUserAttribute({ Name: 'email', Value: email })];
  return new Promise((resolve, reject) => {
    userPool.signUp(email, password, attrs, null, (err, result) =>
      err ? reject(err) : resolve(result));
  });
}

export function confirmSignUp(email, code) {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err, result) =>
      err ? reject(err) : resolve(result));
  });
}

export function login(email, password) {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (result) => resolve(result.getIdToken().getJwtToken()),
      onFailure: reject,
    });
  });
}

// Returns a fresh login token if this device is still signed in, otherwise null.
// The library renews an expired token by itself using the saved refresh token.
export function restoreSession() {
  return new Promise((resolve) => {
    const user = userPool.getCurrentUser();
    if (!user) return resolve(null);
    user.getSession((err, session) => resolve(err || !session || !session.isValid() ? null : session.getIdToken().getJwtToken()));
  });
}

export function signOut() {
  const user = userPool.getCurrentUser();
  if (user) user.signOut();
}
