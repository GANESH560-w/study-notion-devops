import axios from "axios";

export const axiosInstance = axios.create();

axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export const apiConnector = (method, url, bodyData = null, headers = {}, params = null) => {
  return axiosInstance({
    method,
    url,
    data: bodyData,
    headers,
  });
};
