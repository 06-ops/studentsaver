import axios from 'axios';
import { API_BASE_URL } from './config';

export function apiCall(path, token, method = 'GET', data = null) {
  return axios({
    url: `${API_BASE_URL}${path}`,
    method,
    headers: { Authorization: token },
    data,
  });
}